#[allow(dead_code)]
mod support;
use std::{fs, os::unix::fs::PermissionsExt, process::Command, time::Instant};

#[test]
fn bundled_pele_renders_svg_without_a_global_renderer_or_package_install() {
    let review = support::Review::new();
    let root = &review.root;
    let input = root.join("workflow.mmd");
    fs::write(&input, "flowchart TD\n A[Start] --> B[Done]\n").unwrap();
    let binary = root.join("review-artifact");
    fs::copy(env!("CARGO_BIN_EXE_review-artifact"), &binary).unwrap();
    let output = Command::new(binary)
        .arg("render-diagram")
        .arg(&input)
        .current_dir(root)
        .env_remove("NODE_PATH")
        .env("NODE_OPTIONS", "--require ./not-installed.cjs")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let svg = String::from_utf8(output.stdout).unwrap();
    assert!(svg.starts_with("<svg"), "Expected SVG, received: {svg}");
    assert!(svg.contains("Start") && svg.contains("Done"));
    assert!(!svg.contains("<script"));
    assert!(output.stderr.is_empty());
}

#[test]
fn an_explicit_prefix_is_used_for_diagram_accessibility_ids() {
    let review = support::Review::new();
    let input = review.root.join("workflow.mmd");
    fs::write(
        &input,
        "flowchart TD\n accDescr: Start through Done\n A[Start] --> B[Done]\n",
    )
    .unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_review-artifact"))
        .args([
            "render-diagram",
            input.to_str().unwrap(),
            "--id-prefix",
            "workflow-one",
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        String::from_utf8(output.stdout)
            .unwrap()
            .contains("workflow-one")
    );
}

#[test]
fn rendering_never_executes_a_node_program_from_the_source_repository() {
    let review = support::Review::new();
    fs::create_dir(review.root.join(".git")).unwrap();
    let input = review.root.join("workflow.mmd");
    fs::write(&input, "flowchart TD\n A[Start] --> B[Done]\n").unwrap();
    let node = review.root.join("node");
    fs::write(
        &node,
        "#!/bin/sh\nprintf wrong > \"$SOURCE_NODE_CALLED\"\nprintf '<svg>wrong</svg>'\n",
    )
    .unwrap();
    fs::set_permissions(&node, fs::Permissions::from_mode(0o755)).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_review-artifact"))
        .args(["render-diagram", input.to_str().unwrap()])
        .current_dir(&review.root)
        .env("SOURCE_NODE_CALLED", review.root.join("node-used"))
        .env(
            "PATH",
            format!(
                "{}:{}",
                review.root.display(),
                std::env::var("PATH").unwrap()
            ),
        )
        .output()
        .unwrap();
    assert!(
        !review.root.join("node-used").exists(),
        "Source-local Node was executed"
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8(output.stdout).unwrap().contains("Start"));
}

#[test]
fn invalid_sources_never_emit_partial_svg_or_source_contents() {
    let review = support::Review::new();
    let input = review.root.join("invalid.mmd");
    for source in [
        vec![],
        vec![b'x'; 262145],
        vec![0xff],
        b"PRIVATE_TEST_SECRET".to_vec(),
    ] {
        fs::write(&input, source).unwrap();
        let output = review.command(&["render-diagram", input.to_str().unwrap()]);
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
        let error = String::from_utf8(output.stderr).unwrap();
        assert!(!error.is_empty() && !error.contains("PRIVATE_TEST_SECRET"));
    }
    let output = review.command(&["render-diagram", review.root.to_str().unwrap()]);
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert!(
        String::from_utf8(output.stderr)
            .unwrap()
            .contains("regular file")
    );
}

#[test]
fn a_bundled_chart_keeps_its_categories_and_theme_in_a_script_free_review() {
    let review = support::Review::new();
    let input = review.root.join("checks.mmd");
    fs::write(&input, "xychart-beta horizontal\n title \"Review checks\"\n x-axis [Intake, Analysis, Validation, Publication]\n y-axis \"Checks\" 0 --> 10\n bar [3,5,8,4]\n").unwrap();
    let output = review.command(&[
        "render-diagram",
        input.to_str().unwrap(),
        "--max-width",
        "1040",
    ]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let svg = String::from_utf8(output.stdout).unwrap();
    fs::write(
        &review.file,
        format!("<h1>Checks</h1>{svg}<p>Counts per review stage.</p>"),
    )
    .unwrap();
    let opened = review.command(&["open", review.file.to_str().unwrap(), "--no-browser"]);
    assert!(opened.status.success());
    let state: serde_json::Value = review.request("/snapshot", None).json().unwrap();
    let html = state["html"].as_str().unwrap();
    for label in [
        "Intake",
        "Analysis",
        "Validation",
        "Publication",
        "--pele-series-1",
    ] {
        assert!(html.contains(label), "Chart lost {label}");
    }
    assert!(html.contains("<svg") && !html.contains("<script"));
}

#[test]
fn a_missing_node_returns_an_actionable_error_without_partial_svg() {
    let review = support::Review::new();
    let input = review.root.join("workflow.mmd");
    fs::write(&input, "flowchart TD\n A --> B\n").unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_review-artifact"))
        .args(["render-diagram", input.to_str().unwrap()])
        .env("PATH", &review.root)
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert!(
        String::from_utf8(output.stderr)
            .unwrap()
            .contains("Make the configured Node available")
    );
}

#[test]
fn the_deadline_also_stops_a_node_that_never_reads_the_embedded_engine() {
    let review = support::Review::new();
    let source = review.root.join("source");
    fs::create_dir(&source).unwrap();
    let input = source.join("workflow.mmd");
    fs::write(&input, "flowchart TD\n A --> B\n").unwrap();
    let bin = review.root.join("host-bin");
    fs::create_dir(&bin).unwrap();
    let node = bin.join("node");
    fs::write(&node, "#!/bin/sh\nsleep 60\n").unwrap();
    fs::set_permissions(&node, fs::Permissions::from_mode(0o755)).unwrap();
    let start = Instant::now();
    let output = Command::new(env!("CARGO_BIN_EXE_review-artifact"))
        .args(["render-diagram", input.to_str().unwrap()])
        .env(
            "PATH",
            format!("{}:{}", bin.display(), std::env::var("PATH").unwrap()),
        )
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert!(
        String::from_utf8(output.stderr)
            .unwrap()
            .contains("exceeded 30 seconds")
    );
    assert!(
        start.elapsed().as_secs() < 40,
        "Blocked writer outlived the render deadline"
    );
}

#[test]
fn a_successful_launcher_cannot_leave_the_input_writer_waiting_on_a_descendant() {
    let review = support::Review::new();
    let source = review.root.join("source");
    fs::create_dir(&source).unwrap();
    let input = source.join("workflow.mmd");
    fs::write(&input, "flowchart TD\n A --> B\n").unwrap();
    let bin = review.root.join("host-bin");
    fs::create_dir(&bin).unwrap();
    let node = bin.join("node");
    fs::write(
        &node,
        "#!/bin/sh\nexec 3<&0\nsleep 45 <&3 >/dev/null 2>&1 &\nprintf '<svg/>'\nexit 0\n",
    )
    .unwrap();
    fs::set_permissions(&node, fs::Permissions::from_mode(0o755)).unwrap();
    let start = Instant::now();
    let output = Command::new(env!("CARGO_BIN_EXE_review-artifact"))
        .args(["render-diagram", input.to_str().unwrap()])
        .env(
            "PATH",
            format!("{}:{}", bin.display(), std::env::var("PATH").unwrap()),
        )
        .output()
        .unwrap();
    assert!(
        start.elapsed().as_secs() < 40,
        "Input writer escaped the 30-second deadline"
    );
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert!(
        String::from_utf8(output.stderr)
            .unwrap()
            .contains("exceeded 30 seconds")
    );
}

#[test]
fn node_selection_skips_mise_shims_without_running_the_dispatcher() {
    let review = support::Review::new();
    let source = review.root.join("source");
    fs::create_dir(&source).unwrap();
    let input = source.join("workflow.mmd");
    fs::write(&input, "flowchart TD\n A[Start] --> B[Done]\n").unwrap();
    let shims = review.root.join("shims");
    fs::create_dir(&shims).unwrap();
    let mise = review.root.join("mise");
    fs::write(
        &mise,
        "#!/bin/sh\nprintf invoked > \"$MISE_MARKER\"\nexit 19\n",
    )
    .unwrap();
    fs::set_permissions(&mise, fs::Permissions::from_mode(0o755)).unwrap();
    std::os::unix::fs::symlink(&mise, shims.join("node")).unwrap();
    let marker = review.root.join("mise-invoked");
    let output = Command::new(env!("CARGO_BIN_EXE_review-artifact"))
        .args(["render-diagram", input.to_str().unwrap()])
        .env(
            "PATH",
            format!("{}:{}", shims.display(), std::env::var("PATH").unwrap()),
        )
        .env("MISE_MARKER", &marker)
        .output()
        .unwrap();
    assert!(
        !marker.exists(),
        "Renderer invoked the mise dispatcher instead of Node"
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8(output.stdout).unwrap().contains("Start"));
}
