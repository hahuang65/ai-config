//! Exact ordinary harness resource catalogue required before publication.
use super::{check_required_skill, check_support_file};
use crate::configuration::Manifest;
use anyhow::{Result, ensure};
use std::path::Path;

const SKILLS: &[&str] = &[
    "3d",
    "coach",
    "code",
    "commit",
    "grill",
    "handoff",
    "mockup",
    "model-domain",
    "pickup",
    "plan",
    "prototype",
    "resolve-conflicts",
    "review-artifact",
    "review-change",
    "spec",
    "visualize",
    "work-log",
    "worktree",
];
const AGENTS: &[&str] = &[
    "api-designer",
    "change-reviewer",
    "database-reviewer",
    "fact-checker",
    "frontend-architect",
];

fn required(manifest: &Manifest, destination: &str, target: &str) -> Result<()> {
    ensure!(
        manifest.links.iter().any(|link| {
            link.destination == Path::new(destination) && link.target == Path::new(target)
        }),
        "Native package lacks a required resource: {destination}"
    );
    Ok(())
}

fn skills(manifest: &Manifest) -> Result<()> {
    for skill in SKILLS {
        for harness in [".claude", ".pi/agent"] {
            let target = format!("skills/{skill}");
            required(manifest, &format!("{harness}/skills/{skill}"), &target)?;
            check_required_skill(&manifest.source, &target, skill)?;
        }
    }
    Ok(())
}

fn commands(manifest: &Manifest) -> Result<()> {
    for name in ["deliver", "rebase"] {
        let target = format!("commands/{name}.md");
        check_support_file(&manifest.source, &target)?;
        required(manifest, &format!(".claude/commands/{name}.md"), &target)?;
        required(manifest, &format!(".pi/agent/prompts/{name}.md"), &target)?;
    }
    Ok(())
}

fn agents(manifest: &Manifest) -> Result<()> {
    for agent in AGENTS {
        let target = format!("agents/{agent}.md");
        check_support_file(&manifest.source, &target)?;
        for harness in [".claude", ".pi/agent"] {
            required(manifest, &format!("{harness}/agents/{agent}.md"), &target)?;
        }
    }
    Ok(())
}

pub(super) fn check(manifest: &Manifest) -> Result<()> {
    skills(manifest)?;
    agents(manifest)?;
    commands(manifest)
}
