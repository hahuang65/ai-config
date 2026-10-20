use crate::{
    client::Session,
    feedback::{Finish, Lease, Origin},
    feedback_registry,
    paths::{Paths, Result},
};
use clap::{Args, Subcommand};
use serde_json::{Value, json};
use std::path::PathBuf;

#[derive(Args)]
pub struct OriginArgs {
    #[arg(long, value_parser = ["pi", "claude"])]
    harness: String,
    #[arg(long)]
    conversation: String,
    #[arg(long)]
    workspace: PathBuf,
}

impl OriginArgs {
    fn origin(self) -> Result<Origin> {
        Origin {
            harness: self.harness,
            conversation: self.conversation,
            workspace: self.workspace,
        }
        .validated()
    }
}

#[derive(Args)]
pub struct LeaseArgs {
    #[arg(long, value_parser = clap::value_parser!(i64).range(1..))]
    cursor: i64,
    #[arg(long)]
    attempt: String,
}

impl LeaseArgs {
    fn lease(self) -> Result<Lease> {
        let lease = Lease {
            cursor: self.cursor,
            attempt: self.attempt,
        };
        lease.validate()?;
        Ok(lease)
    }
}

#[derive(Subcommand)]
pub enum Command {
    /// Native hook: record this conversation's current workspace before feedback delivery.
    Focus {
        #[command(flatten)]
        origin: OriginArgs,
    },
    /// Attach feedback to its originating agent without waiting for human input.
    Attach {
        file: PathBuf,
        #[command(flatten)]
        origin: OriginArgs,
        /// Fresh open receipt, required by automatic native adapters.
        #[arg(long)]
        ticket: Option<String>,
    },
    /// Revise current report wording without changing source scope or existing decisions.
    Revise {
        file: PathBuf,
        #[arg(long)]
        revision: String,
        #[arg(long)]
        report_digest: String,
        #[arg(long)]
        edit: String,
    },
    /// List review artifact paths attached to this exact conversation and workspace.
    Attached {
        #[command(flatten)]
        origin: OriginArgs,
        /// Recover unclaimed delivery when this originating conversation resumes.
        #[arg(long)]
        reset_notifications: bool,
    },
    /// Inspect claimed leases for this originating conversation.
    Active {
        #[command(flatten)]
        origin: OriginArgs,
    },
    /// Abandon previous processing at an interruption or a new user-prompt boundary.
    Abandon {
        #[command(flatten)]
        origin: OriginArgs,
    },
    /// Native adapter listener. Runs outside the agent tool call and exits for renewal or one saved event.
    Listen {
        #[command(flatten)]
        origin: OriginArgs,
        #[arg(long, default_value_t = 3300, value_parser = clap::value_parser!(u64).range(0..=3300))]
        seconds: u64,
    },
    /// Begin processing the next saved event for this exact origin. Does not wait.
    Claim {
        file: PathBuf,
        #[command(flatten)]
        origin: OriginArgs,
    },
    /// Renew a claimed event while its native responder is still processing it.
    Renew {
        file: PathBuf,
        #[command(flatten)]
        lease: LeaseArgs,
    },
    /// Retain an interrupted event as Needs attention; never infer completion.
    Fail {
        file: PathBuf,
        #[command(flatten)]
        lease: LeaseArgs,
    },
    /// Save one idempotent reply and complete its claimed event.
    Finish {
        file: PathBuf,
        #[command(flatten)]
        lease: LeaseArgs,
        #[arg(long)]
        message: String,
    },
}

pub fn execute(command: Command) -> Result<Value> {
    match command {
        Command::Focus { origin } => {
            feedback_registry::focus(&origin.origin()?)?;
            Ok(json!({"focused":true}))
        }
        Command::Revise {
            file,
            revision,
            report_digest,
            edit,
        } => revise(file, revision, report_digest, edit),
        Command::Attached {
            origin,
            reset_notifications,
        } => {
            let origin = origin.origin()?;
            if reset_notifications {
                feedback_registry::reset_notifications(&origin)?;
            }
            Ok(json!({"artifacts":feedback_registry::attached(origin)?}))
        }
        Command::Active { origin } => {
            Ok(json!({"active":feedback_registry::active(&origin.origin()?, false)?}))
        }
        Command::Abandon { origin } => abandon(origin.origin()?),
        Command::Listen { origin, seconds } => {
            crate::feedback_delivery::listen(origin.origin()?, seconds)
        }
        Command::Attach {
            file,
            origin,
            ticket,
        } => attach(file, origin.origin()?, ticket),
        Command::Claim { file, origin } => claim(file, origin.origin()?),
        Command::Renew { file, lease } => request(file, "/feedback/renew", lease.lease()?),
        Command::Fail { file, lease } => complete(file, lease.lease()?, None),
        Command::Finish {
            file,
            lease,
            message,
        } => complete(file, lease.lease()?, Some(message)),
    }
}

fn revise(file: PathBuf, revision: String, report_digest: String, edit: String) -> Result<Value> {
    if edit.len() > 120 * 1024 {
        return Err("Report wording edit exceeds its limit.");
    }
    let edit: evaluation::report_edit::Revision =
        serde_json::from_str(&edit).map_err(|_| "Invalid report wording edit JSON.")?;
    request(
        file,
        "/feedback/revise",
        json!({"revision":revision,"report_digest":report_digest,"edit":edit}),
    )
}

fn attach(file: PathBuf, origin: Origin, ticket: Option<String>) -> Result<Value> {
    match ticket {
        None => request(file, "/feedback/attach", origin),
        Some(ticket) => {
            if ticket.len() != 32 || !ticket.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return Err("Automatic attachment receipt must be 32 hexadecimal characters.");
            }
            request(
                file,
                "/feedback/attach-ticket",
                json!({"origin":origin,"ticket":ticket}),
            )
        }
    }
}

fn claim(file: PathBuf, origin: Origin) -> Result<Value> {
    feedback_registry::validate_claim(&origin)?;
    let result = request(file.clone(), "/feedback/claim", &origin)?;
    let job: Option<crate::feedback::Job> =
        serde_json::from_value(result.clone()).map_err(|_| "Invalid feedback claim.")?;
    if let Some(job) = job {
        feedback_registry::activate(
            &Paths::resolve(&file)?,
            &origin,
            &Lease {
                cursor: job.cursor,
                attempt: job.attempt,
            },
        )?;
    }
    Ok(result)
}

fn complete(file: PathBuf, lease: Lease, message: Option<String>) -> Result<Value> {
    let result = match message {
        Some(message) => {
            let finish = Finish {
                cursor: lease.cursor,
                attempt: lease.attempt.clone(),
                message,
            };
            finish.reply().validate()?;
            request(file.clone(), "/feedback/finish", finish)?
        }
        None => request(file.clone(), "/feedback/fail", &lease)?,
    };
    feedback_registry::clear_active(&Paths::resolve(&file)?.artifact, &lease)?;
    Ok(result)
}

fn abandon(origin: Origin) -> Result<Value> {
    let mut unconfirmed = 0;
    for entry in feedback_registry::active(&origin, true)? {
        if request(entry.artifact, "/feedback/fail", entry.lease).is_err() {
            unconfirmed += 1;
        }
    }
    Ok(json!({"retained":true,"unconfirmed":unconfirmed}))
}

fn request(file: PathBuf, route: &str, payload: impl serde::Serialize) -> Result<Value> {
    let body = serde_json::to_value(payload).map_err(|_| "Cannot encode feedback request.")?;
    Session::connect(&Paths::resolve(&file)?)?.request(route, Some(&body))
}
