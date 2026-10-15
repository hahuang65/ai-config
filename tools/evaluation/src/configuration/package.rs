//! Validate an inactive replacement package before any installer transaction.
use super::{Manifest, Mode, check_sources, document, real_ancestors, targets};
use anyhow::{Context, Result, ensure};
use std::ffi::CString;
use std::fs::{self, OpenOptions};
use std::io::Read;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::Path;

const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
const MAX_SKILL_BYTES: u64 = 64 * 1024;
const CLAUDE_GUARD_COMMAND: &str = "bun ~/.claude/hooks/guard.ts";
const CLAUDE_GUARD_TIMEOUT_SECONDS: u64 = 10;
const MAX_RESOURCE_ENTRIES: usize = 100_000;
const MAX_RESOURCE_DEPTH: usize = 128;
const REQUIRED: &[(&str, &str)] = &[
    (".claude/CLAUDE.md", "baseline.md"),
    (".pi/agent/AGENTS.md", "baseline.md"),
    (".claude/hooks/guard.ts", "harnesses/claude/guard.ts"),
    (".claude/hooks/worktree.ts", "harnesses/claude/worktree.ts"),
    (
        ".pi/agent/extensions/worktree.ts",
        "harnesses/pi/worktree.bundle.ts",
    ),
    (".claude/statusline.ts", "harnesses/claude/statusline.ts"),
    (
        ".claude/themes/catppuccin-mocha.json",
        "harnesses/claude/themes/catppuccin-mocha.json",
    ),
    (
        ".pi/agent/extensions/guard-policies.ts",
        "harnesses/pi/guard-policies.bundle.ts",
    ),
    (
        ".pi/agent/extensions/status-footer.ts",
        "harnesses/pi/status-footer.bundle.ts",
    ),
    (
        ".pi/agent/themes/catppuccin-mocha.json",
        "harnesses/pi/themes/catppuccin-mocha.json",
    ),
];
#[path = "package_catalogue.rs"]
mod catalogue;
#[path = "package_settings.rs"]
mod package_settings;
const BUNDLED_TOOLS: &[(&str, &str)] = &[
    (".local/bin/wt", "tools/worktree/target/release/wt"),
    (".local/bin/worktree", "tools/worktree/target/release/wt"),
    (".local/bin/wl", "tools/worklog/target/release/wl"),
    (".local/bin/worklog", "tools/worklog/target/release/wl"),
    (
        ".local/bin/review-change",
        "tools/evaluation/target/release/review-change",
    ),
];
const PRIVATE_TOOLS: &[&str] = &[
    "tools/artifact-review/target/release/review-artifact",
    "tools/evaluation/target/release/consult",
];
const SUPPORT: &[&str] = &[
    "harnesses/worktree-client.ts",
    "docs/worktree-transitions.md",
    "harnesses/pi/worktree.ts",
    "harnesses/pi/review-scope.ts",
    "reviewer.md",
    "harnesses/pi/guard-policies.ts",
    "harnesses/pi/status-footer.ts",
    "harnesses/claude/harness-rules.md",
    "harnesses/claude/plugins/ai-local-lsp/.claude-plugin/plugin.json",
    "harnesses/claude/guard-verdict.ts",
    "harnesses/claude/read-only-github.ts",
    "guard/bash-command.ts",
    "guard/credential-guard.ts",
    "guard/guard-core.ts",
    "guard/guard-home.ts",
    "guard/inline-program-state-guard.ts",
    "guard/policy-registry.ts",
    "guard/review-publication-state-guard.ts",
    "rules/a5.md",
    "rules/cli-ergonomics.md",
    "rules/coding-style.md",
    "rules/documentation.md",
    "rules/git-commit.md",
    "rules/html-routing.md",
    "rules/mise.md",
    "rules/performance.md",
    "rules/security.md",
    "rules/testing.md",
];

/// Read a local package only; this does not adopt, install, or assert runtime parity.
pub fn prepared_manifest(source: &Path) -> Result<Manifest> {
    ensure!(
        source.is_absolute() && source.is_dir(),
        "Package source must be an absolute directory"
    );
    ensure!(
        source.canonicalize()?.as_os_str() == source.as_os_str(),
        "Package source must be canonical"
    );
    real_ancestors(source)?;
    let path = source.join("manifest.json");
    real_ancestors(path.parent().context("Missing package directory")?)?;
    let bytes = read_manifest(&path)?;
    document::object(&bytes).context("Invalid native package manifest")?;
    let mut manifest: Manifest =
        serde_json::from_slice(&bytes).context("Invalid native package manifest")?;
    ensure!(
        manifest.version == 2
            && (manifest.source == Path::new(".")
                || manifest.source.as_os_str() == source.as_os_str()),
        "Native package source or version does not match the installer"
    );
    manifest.source = source.to_owned();
    let links = targets(&manifest)?;
    check_sources(Path::new("/"), &manifest, &links)?;
    check_modules(&manifest)?;
    check_claude_guard_hook(&manifest)?;
    package_settings::check(&manifest)?;
    Ok(manifest)
}

fn read_manifest(path: &Path) -> Result<Vec<u8>> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .context("Native package manifest is missing or redirected")?;
    let metadata = file.metadata()?;
    ensure!(
        metadata.is_file() && metadata.nlink() == 1 && metadata.len() <= MAX_MANIFEST_BYTES,
        "Native package manifest must be a bounded regular file"
    );
    let mut bytes = Vec::new();
    file.take(MAX_MANIFEST_BYTES + 1).read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() as u64 <= MAX_MANIFEST_BYTES,
        "Native package manifest is too large"
    );
    Ok(bytes)
}

fn check_modules(manifest: &Manifest) -> Result<()> {
    for link in &manifest.links {
        let shared = link.target == Path::new("baseline.md")
            || ["skills", "agents", "commands"]
                .iter()
                .any(|directory| link.target.starts_with(directory));
        let allowed = if link.destination.starts_with(".claude") {
            shared || link.target.starts_with("harnesses/claude")
        } else if link.destination.starts_with(".pi/agent") {
            shared || link.target.starts_with("harnesses/pi")
        } else {
            BUNDLED_TOOLS.iter().any(|&(name, target)| {
                link.destination == Path::new(name) && link.target == Path::new(target)
            })
        };
        ensure!(allowed, "Native package crosses harness module boundaries");
        let target = manifest.source.join(&link.target);
        real_ancestors(target.parent().context("Missing resource parent")?)?;
        check_resource_tree(&target)?;
    }
    for &(destination, target) in REQUIRED {
        ensure!(
            manifest.links.iter().any(|link| {
                link.destination == Path::new(destination) && link.target == Path::new(target)
            }),
            "Native package lacks a required bootstrap or guard adapter: {destination}"
        );
        check_support_file(&manifest.source, target)?;
    }
    ensure!(
        manifest.links.iter().any(|link| {
            link.destination == Path::new(".claude/plugins/ai-local-lsp")
                && link.target == Path::new("harnesses/claude/plugins/ai-local-lsp")
        }),
        "Native package lacks the local language-server plugin"
    );
    for target in SUPPORT {
        check_support_file(&manifest.source, target)?;
    }
    check_local_lsp_plugin(manifest)?;
    catalogue::check(manifest)?;
    check_bundled_tools(manifest)?;
    Ok(())
}

fn check_local_lsp_plugin(manifest: &Manifest) -> Result<()> {
    let root = manifest
        .source
        .join("harnesses/claude/plugins/ai-local-lsp");
    let contents = root.join(".claude-plugin");
    for (directory, allowed) in [
        (root.as_path(), ".claude-plugin"),
        (contents.as_path(), "plugin.json"),
    ] {
        for entry in fs::read_dir(directory)? {
            ensure!(
                entry?.file_name() == allowed,
                "Local language-server plugin cannot import skills or other runtime resources"
            );
        }
    }
    let actual: serde_json::Value =
        serde_json::from_slice(&fs::read(contents.join("plugin.json"))?)?;
    let expected: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../harnesses/claude/plugins/ai-local-lsp/.claude-plugin/plugin.json"
    ))?;
    ensure!(
        actual == expected,
        "Local language-server plugin must match the reviewed language-server-only definition"
    );
    Ok(())
}

fn check_bundled_tools(manifest: &Manifest) -> Result<()> {
    for &(destination, target) in BUNDLED_TOOLS {
        ensure!(
            manifest.links.iter().any(|link| {
                link.destination == Path::new(destination) && link.target == Path::new(target)
            }),
            "Native package lacks a bundled tool: {destination}"
        );
    }
    for target in BUNDLED_TOOLS
        .iter()
        .map(|(_, target)| *target)
        .chain(PRIVATE_TOOLS.iter().copied())
    {
        check_support_file(&manifest.source, target)?;
        let path = manifest.source.join(target);
        let c_path = CString::new(path.as_os_str().as_bytes())?;
        let executable = unsafe {
            libc::faccessat(
                libc::AT_FDCWD,
                c_path.as_ptr(),
                libc::X_OK,
                libc::AT_EACCESS,
            ) == 0
        };
        ensure!(
            executable,
            "Native bundled tool must be executable: {target}"
        );
    }
    Ok(())
}

fn check_required_skill(source: &Path, target: &str, name: &str) -> Result<()> {
    let relative = format!("{target}/SKILL.md");
    check_support_file(source, &relative)?;
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(source.join(&relative))?;
    let mut bytes = Vec::new();
    file.take(MAX_SKILL_BYTES + 1).read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() as u64 <= MAX_SKILL_BYTES,
        "Native required skill is too large: {relative}"
    );
    let content = std::str::from_utf8(&bytes).context("Native required skill is not UTF-8")?;
    let (header, body) = content
        .strip_prefix("---\n")
        .and_then(|rest| rest.split_once("\n---\n"))
        .context("Native required skill has no frontmatter")?;
    let unique = |key: &str| {
        let mut values = header.lines().filter_map(|line| line.strip_prefix(key));
        let first = values.next();
        first.filter(|_| values.next().is_none())
    };
    ensure!(
        unique("name: ") == Some(name)
            && unique("description: ")
                .is_some_and(|text| { !text.trim().is_empty() && text.len() <= 1024 })
            && !body.trim().is_empty(),
        "Native required skill metadata or instructions are invalid: {relative}"
    );
    Ok(())
}

fn check_support_file(source: &Path, relative: &str) -> Result<()> {
    let path = source.join(relative);
    real_ancestors(path.parent().context("Missing support resource parent")?)?;
    ensure!(
        fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.is_file()),
        "Native support resource must be a regular file: {relative}"
    );
    Ok(())
}

fn check_claude_guard_hook(manifest: &Manifest) -> Result<()> {
    let hook = serde_json::json!({
        "hooks": [{"type": "command", "command": CLAUDE_GUARD_COMMAND,
                   "timeout": CLAUDE_GUARD_TIMEOUT_SECONDS}]
    });
    ensure!(
        manifest.settings.iter().any(|setting| {
            setting.destination == Path::new(".claude/settings.json")
                && setting
                    .path
                    .iter()
                    .map(String::as_str)
                    .eq(["hooks", "PreToolUse"])
                && setting.mode == Mode::ArrayEntry
                && setting.value == hook
        }),
        "Native Claude guard needs an owned PreToolUse hook for all tools"
    );
    Ok(())
}

fn check_resource_tree(root: &Path) -> Result<()> {
    scan_resource_tree(root, MAX_RESOURCE_ENTRIES)
}

fn scan_resource_tree(root: &Path, limit: usize) -> Result<()> {
    let mut pending = vec![(root.to_owned(), 0)];
    let mut visited = 0;
    while let Some((path, depth)) = pending.pop() {
        visited += 1;
        ensure!(
            visited <= limit && depth <= MAX_RESOURCE_DEPTH,
            "Native package resource is too large or deep"
        );
        let metadata = fs::symlink_metadata(&path)?;
        ensure!(
            metadata.is_file() || metadata.is_dir(),
            "Native package resource must be a regular file or directory"
        );
        if metadata.is_dir() {
            for entry in fs::read_dir(&path)? {
                ensure!(
                    visited + pending.len() < limit,
                    "Native package resource is too large"
                );
                pending.push((entry?.path(), depth + 1));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "package_budget_tests.rs"]
mod budget_tests;
