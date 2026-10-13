//! Frozen default resource layout of ai-config at 2f04c8f0600f1abc72e83409f2ba0a831af915cc.
//! Update with captured installer evidence, not by scanning an installed home.
use super::LegacyLink;
use std::path::Path;

const SKILLS: &[&str] = &[
    "3d",
    "build",
    "coach",
    "code",
    "commit",
    "grill",
    "handoff",
    "mockup",
    "model-domain",
    "orchard",
    "pickup",
    "prototype",
    "record-work",
    "refactor",
    "resolve-conflicts",
    "review-artifact",
    "review-change",
    "review-code",
    "shared",
    "spec",
    "summarize-work",
    "todo",
    "visualize",
    "visualize-diff",
];
const AGENTS: &[&str] = &[
    "api-designer",
    "architecture-reviewer",
    "change-fixer",
    "change-reviewer",
    "database-reviewer",
    "fact-checker",
    "frontend-architect",
    "refactorer",
    "tdd-guide",
];
const MEMORY_FILES: &[&str] = &[
    "client", "commands", "config", "events", "footer", "index", "runtime", "support", "tools",
    "types",
];
const PI_EXTENSIONS: &[&str] = &[
    "agentmemory-owner",
    "local-models",
    "orchard",
    "review-change-guard",
    "review-change-progress",
    "write-tool-highlights",
];

pub(super) fn links(source: &Path, upstream: &Path, agentmemory: &Path) -> Vec<LegacyLink> {
    let mut links = Vec::new();
    shared_links(&mut links, source);
    claude_links(&mut links, source);
    pi_links(&mut links, source, upstream);
    add(
        &mut links,
        source,
        ".local/bin/review-change",
        "skills/review-change/bin/review-change.mjs",
    );
    add(
        &mut links,
        source,
        ".local/bin/work-log",
        "skills/record-work/bin/work-log.mjs",
    );
    links.push(LegacyLink {
        destination: ".local/bin/agentmemory".into(),
        target: agentmemory.to_owned(),
    });
    links
}

fn shared_links(links: &mut Vec<LegacyLink>, source: &Path) {
    for (root, commands, instructions) in [
        (".claude", "commands", "CLAUDE.md"),
        (".pi/agent", "prompts", "AGENTS.md"),
    ] {
        for skill in SKILLS {
            add(
                links,
                source,
                &format!("{root}/skills/{skill}"),
                &format!("skills/{skill}"),
            );
        }
        for agent in AGENTS {
            add(
                links,
                source,
                &format!("{root}/agents/{agent}.md"),
                &format!("agents/{agent}.md"),
            );
        }
        for command in ["deliver", "rebase"] {
            add(
                links,
                source,
                &format!("{root}/{commands}/{command}.md"),
                &format!("commands/{command}.md"),
            );
        }
        add(
            links,
            source,
            &format!("{root}/{instructions}"),
            "baseline-prompt.md",
        );
    }
}

fn add(links: &mut Vec<LegacyLink>, source: &Path, destination: &str, relative: &str) {
    links.push(LegacyLink {
        destination: destination.into(),
        target: source.join(relative),
    });
}

fn claude_links(links: &mut Vec<LegacyLink>, source: &Path) {
    for relative in [
        "statusline.sh",
        "hooks.json",
        "hooks/review-change-publication.ts",
        "hooks/work-log-reconcile.ts",
        "themes/catppuccin-mocha.json",
    ] {
        add(
            links,
            source,
            &format!(".claude/{relative}"),
            &format!("harnesses/claude/{relative}"),
        );
    }
}

fn pi_links(links: &mut Vec<LegacyLink>, source: &Path, upstream: &Path) {
    for name in [
        "guard-policies",
        "review-change-publication",
        "work-log-reconcile",
    ] {
        add(
            links,
            source,
            &format!(".pi/agent/extensions/{name}.ts"),
            &format!("harnesses/pi/{name}.bundle.ts"),
        );
    }
    for name in MEMORY_FILES {
        let relative = format!("extensions/agentmemory/{name}.ts");
        add(
            links,
            source,
            &format!(".pi/agent/{relative}"),
            &format!("harnesses/pi/{relative}"),
        );
    }
    for name in PI_EXTENSIONS {
        let relative = format!("extensions/{name}.ts");
        add(
            links,
            source,
            &format!(".pi/agent/{relative}"),
            &format!("harnesses/pi/{relative}"),
        );
    }
    subagent_links(links, source, upstream);
    add(
        links,
        source,
        ".pi/agent/themes/catppuccin-mocha.json",
        "harnesses/pi/themes/catppuccin-mocha.json",
    );
}

fn subagent_links(links: &mut Vec<LegacyLink>, source: &Path, upstream: &Path) {
    for name in ["agents", "tool-names", "model-selection"] {
        let relative = format!("extensions/subagent/{name}.ts");
        add(
            links,
            source,
            &format!(".pi/agent/{relative}"),
            &format!("harnesses/pi/{relative}"),
        );
    }
    links.push(LegacyLink {
        destination: ".pi/agent/extensions/subagent/index.ts".into(),
        target: upstream.join("index.ts"),
    });
}
