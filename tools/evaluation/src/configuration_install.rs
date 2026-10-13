//! Public one-way native installation; explicit historical paths are adoption authority.
use crate::configuration::{
    LegacyInstallation, adopt_configuration, evaluation_legacy_inventory, preflight_adoption,
    prepared_manifest, shared_legacy_inventory, switch_configuration,
};
use crate::paths::{Paths, present};
use anyhow::{Context, Result, ensure};
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::PathBuf;

const SHARED: [&str; 3] = [
    "--legacy-shared",
    "--legacy-pi-subagents",
    "--legacy-agentmemory",
];
const EVALUATION: [&str; 4] = [
    "--legacy-evaluation",
    "--legacy-evaluation-binary",
    "--legacy-worktree",
    "--legacy-worklog",
];
const OPTIONS: [&str; 7] = [
    SHARED[0],
    SHARED[1],
    SHARED[2],
    EVALUATION[0],
    EVALUATION[1],
    EVALUATION[2],
    EVALUATION[3],
];

pub const HELP: &str = "Usage: evaluation [--root ROOT] native-install [explicit historical paths]
Install the complete inactive native package for ordinary Claude and Pi together.
Fresh homes need no historical paths. To adopt old resources, provide all three shared paths:
  --legacy-shared SOURCE --legacy-pi-subagents DIR --legacy-agentmemory EXECUTABLE
If evaluation launchers exist, also provide all four evaluation paths:
  --legacy-evaluation SOURCE --legacy-evaluation-binary EXECUTABLE
  --legacy-worktree SOURCE --legacy-worklog SOURCE
Historical paths are explicit authority, not inferred from installed links.
Add --check with complete historical paths to inspect the adoption plan without writing HOME.
The check is advisory: installation repeats it under a lock and may refuse if files change.
Only exact captured legacy links are adopted. Unrelated files and state remain untouched.
A recorded installation uses its own ownership record for repeat installation.
No dependencies, services, profiles, or sessions are installed or stopped.
Build required bundled executables before running this command. Live activation needs separate approval.
";

#[derive(Default)]
pub struct Options {
    shared: Option<[PathBuf; 3]>,
    evaluation: Option<[PathBuf; 4]>,
    check: bool,
}

impl Options {
    pub fn is_check(&self) -> bool {
        self.check
    }
}

pub fn is_help(arguments: &[OsString]) -> bool {
    arguments == ["--help"] || arguments == ["-h"]
}

pub fn parse(arguments: &[OsString]) -> Result<Options> {
    let mut check = false;
    let mut pairs = Vec::new();
    for argument in arguments {
        if argument == "--check" {
            ensure!(!check, "Duplicate --check option; {HELP}");
            check = true;
        } else {
            pairs.push(argument.clone());
        }
    }
    ensure!(
        pairs.len().is_multiple_of(2),
        "Native install options need values; {HELP}"
    );
    let mut values = BTreeMap::new();
    for pair in pairs.as_chunks::<2>().0 {
        let name = pair[0]
            .to_str()
            .context("Native install options must be text")?;
        ensure!(
            OPTIONS.contains(&name),
            "Unsupported native install option; {HELP}"
        );
        let value = PathBuf::from(&pair[1]);
        ensure!(
            value.is_absolute() && value.parent().is_some(),
            "Historical paths must be absolute and non-root"
        );
        ensure!(
            values.insert(name, value).is_none(),
            "Duplicate native install option: {name}"
        );
    }
    let shared = group::<3>(&values, &SHARED)?;
    let evaluation = group::<4>(&values, &EVALUATION)?;
    ensure!(
        evaluation.is_none() || shared.is_some(),
        "Evaluation adoption requires the shared legacy inventory"
    );
    ensure!(
        !check || shared.is_some(),
        "--check requires complete shared historical paths; {HELP}"
    );
    Ok(Options {
        shared,
        evaluation,
        check,
    })
}

fn group<const N: usize>(
    values: &BTreeMap<&str, PathBuf>,
    names: &[&str; N],
) -> Result<Option<[PathBuf; N]>> {
    let present = names
        .iter()
        .filter(|name| values.contains_key(**name))
        .count();
    ensure!(
        present == 0 || present == N,
        "Historical path group must be complete"
    );
    Ok((present == N).then(|| names.map(|name| values[name].clone())))
}

fn legacy(options: &Options) -> Result<Option<LegacyInstallation>> {
    let Some([source, upstream, agentmemory]) = &options.shared else {
        return Ok(None);
    };
    let mut installation = shared_legacy_inventory(source, upstream, agentmemory)?.installation;
    if let Some([source, executable, worktree, worklog]) = &options.evaluation {
        let evaluated = evaluation_legacy_inventory(source, executable, worktree, worklog)?;
        installation.links.extend(evaluated.installation.links);
    }
    Ok(Some(installation))
}

pub fn launch(paths: &Paths, options: &Options) -> Result<()> {
    let manifest = prepared_manifest(&paths.root)?;
    if options.check {
        let previous =
            legacy(options)?.context("--check requires historical adoption authority")?;
        preflight_adoption(&paths.home, &manifest, &previous)?;
        println!(
            "Native adoption preflight passed without changing the home; repeat this check immediately before installation."
        );
        return Ok(());
    }
    let record = paths.home.join(".local/state/ai-config/installation.json");
    if present(&record)? {
        switch_configuration(&paths.home, &manifest)?;
    } else if let Some(previous) = legacy(options)? {
        adopt_configuration(&paths.home, &manifest, &previous)?;
    } else {
        switch_configuration(&paths.home, &manifest)?;
    }
    Ok(())
}
