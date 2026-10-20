use super::{Service, failure};
use crate::feedback::{Finish, Job, Lease};
use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

pub async fn configure(State(service): State<Service>) -> Response {
    let result = service
        .store
        .lock()
        .expect("store lock")
        .configure_standalone(&service.paths);
    match result {
        Ok(()) => {
            service.updates.send_modify(|_| {});
            Json(json!({"configured":true})).into_response()
        }
        Err(message) => failure(StatusCode::CONFLICT, message),
    }
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Retry {
    cursor: i64,
}

pub async fn retry(
    State(service): State<Service>,
    body: std::result::Result<Json<Retry>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let Ok(Json(request)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Invalid retry event.");
    };
    let result = service
        .store
        .lock()
        .expect("store lock")
        .retry_standalone(request.cursor);
    match result {
        Ok(()) => {
            service.updates.send_modify(|_| {});
            Json(json!({"accepted":true})).into_response()
        }
        Err(message) => failure(StatusCode::CONFLICT, message),
    }
}

struct Cancellation(Arc<AtomicBool>);
impl Drop for Cancellation {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

pub async fn run(service: Service) {
    let mut updates = service.updates.subscribe();
    loop {
        if *updates.borrow() {
            return;
        }
        let job = {
            service
                .store
                .lock()
                .expect("store lock")
                .claim_standalone(&service.paths)
        };
        match job {
            Ok(Some(job)) => {
                service.updates.send_modify(|_| {});
                process(&service, job, &mut updates).await;
            }
            Ok(None) => {
                if updates.changed().await.is_err() {
                    return;
                }
            }
            Err(_) => {
                service.store.lock().expect("store lock").fail_queued();
                service.updates.send_modify(|_| {});
                return;
            }
        }
    }
}

type Answer = evaluation::feedback_response::Response;
type ResponseTask = tokio::task::JoinHandle<std::result::Result<Answer, &'static str>>;

async fn process(service: &Service, job: Job, updates: &mut tokio::sync::watch::Receiver<bool>) {
    let cancel = Cancellation(Arc::new(AtomicBool::new(false)));
    let response = launch(service, &job, cancel.0.clone());
    let lease = Lease {
        cursor: job.cursor,
        attempt: job.attempt,
    };
    let result = await_response(service, &lease, &cancel.0, response, updates).await;
    let service = service.clone();
    let _ = tokio::task::spawn_blocking(move || complete(&service, &lease, result)).await;
}

fn launch(service: &Service, job: &Job, flag: Arc<AtomicBool>) -> ResponseTask {
    let paths = service.paths.clone();
    let event = service
        .store
        .lock()
        .expect("store lock")
        .feedback_context(&job.event);
    let binding = service.store.lock().expect("store lock").finding_binding();
    tokio::task::spawn_blocking(move || {
        let binding = binding?.ok_or("Missing retained report.")?;
        evaluation::feedback_response::respond(
            &paths.artifact,
            &binding.report_digest,
            &binding.revision,
            &event?,
            flag,
        )
        .map_err(|_| "Restricted responder did not complete.")
    })
}

async fn await_response(
    service: &Service,
    lease: &Lease,
    flag: &Arc<AtomicBool>,
    mut response: ResponseTask,
    updates: &mut tokio::sync::watch::Receiver<bool>,
) -> Option<Answer> {
    let mut heartbeat = tokio::time::interval(std::time::Duration::from_secs(20));
    loop {
        tokio::select! {
            result = &mut response => return result.ok().and_then(Result::ok),
            _ = heartbeat.tick() => {
                let renewed = service.store.lock().expect("store lock").renew_feedback(lease);
                if renewed.is_err() { flag.store(true, Ordering::Relaxed); let _ = response.await; return None; }
            },
            _ = updates.changed() => if *updates.borrow() {
                flag.store(true, Ordering::Relaxed); let _ = response.await; return None;
            },
        }
    }
}

fn complete(service: &Service, lease: &Lease, result: Option<Answer>) {
    let mut store = service.store.lock().expect("store lock");
    let finished = result.and_then(|result| {
        store.renew_feedback(lease).ok()?;
        if let Some(edit) = &result.revision {
            let binding = store.finding_binding().ok()??;
            store
                .revise_report(
                    &service.paths,
                    &binding.report_digest,
                    &binding.revision,
                    edit,
                )
                .ok()?;
        }
        store
            .finish_feedback(
                &service.paths,
                Finish {
                    cursor: lease.cursor,
                    attempt: lease.attempt.clone(),
                    message: result.reply,
                },
            )
            .ok()
    });
    if finished.is_none() {
        let _ = store.fail_feedback(lease);
    }
    service.updates.send_modify(|_| {});
}
