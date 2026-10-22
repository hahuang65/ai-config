#[allow(dead_code)]
mod support;
use serde_json::{Value, json};
use support::Review;

fn snapshot(source: &str) -> Value {
    let review = Review::new();
    std::fs::write(&review.file, source).unwrap();
    let opened = review.command(&["open", review.file.to_str().unwrap(), "--no-browser"]);
    assert!(opened.status.success());
    let response = review.request("/snapshot", None);
    assert_eq!(response.status(), 200);
    response.json().unwrap()
}

#[test]
fn a_static_vector_diagram_keeps_its_geometry_labels_and_theme() {
    let result = snapshot(
        r##"<h1>Review workflow</h1><svg xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 240 80" width="240" height="80" role="img" aria-label="Review queued"
        style="--_fg:var(--pele-fg,#202432);font:16px Arial;max-width:100%;height:auto">
        <title>Hidden vector metadata</title><desc id="vector-note">Queued review status</desc>
        <g class="pele-node" transform="translate(10,10)">
        <rect width="220" height="60" rx="4" fill="#eef2f8" stroke="var(--_fg)"/>
        <text x="20" y="36" fill="var(--_fg)">Review queued</text></g></svg>"##,
    );
    let html = result["html"].as_str().unwrap();
    assert!(
        html.contains("<svg"),
        "Static SVG must remain visible: {html}"
    );
    assert!(!html.contains("Hidden vector metadata"));
    for expected in [
        "viewBox=\"0 0 240 80\"",
        "<desc id=\"vector-note\">Queued review status</desc>",
        "aria-label=\"Review queued\"",
        "transform=\"translate(10,10)\"",
        "fill=\"var(--_fg)\"",
        "--_fg:var(--pele-fg,#202432)",
        ">Review queued</text>",
    ] {
        assert!(html.contains(expected), "Missing {expected}: {html}");
    }
}

#[test]
fn a_vector_diagram_keeps_local_markers_clipping_and_gradients() {
    let result = snapshot(
        r##"<svg viewBox="0 0 200 80"><defs>
        <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
        <path d="M0,0 L0,6 L9,3 z" fill="currentColor"/></marker>
        <clipPath id="clip"><rect width="200" height="80"/></clipPath>
        <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#fff"/><stop offset="100%" stop-color="#abc"/></linearGradient>
        </defs><path d="M10,40 L180,40" marker-end="url(#arrow)" stroke="#123"/>
        <rect width="100" height="40" clip-path="url('#clip')" fill="url(#shade)"/>
        </svg>"##,
    );
    let html = result["html"].as_str().unwrap();
    for expected in [
        "<marker",
        "markerWidth=\"10\"",
        "<clipPath",
        "<linearGradient",
        "marker-end=\"url(#arrow)\"",
        "fill=\"url(#shade)\"",
    ] {
        assert!(html.contains(expected), "Missing {expected}: {html}");
    }
}

#[test]
fn active_vector_content_and_external_paint_references_are_removed() {
    let result = snapshot(
        r##"<svg onload="alert(1)" viewBox="0 0 100 100">
        <script>parent.compromised = true</script>
        <foreignObject><div>Embedded HTML must disappear</div><img src="https://unsafe.invalid/a"/></foreignObject>
        <image href="https://unsafe.invalid/image"/><use href="external.svg#shape"/>
        <animate attributeName="href" values="javascript:alert(1)"/><set attributeName="onload" to="alert(1)"/>
        <path d="M0,0 L10,10" onclick="alert(1)" fill="url(https://unsafe.invalid/fill)"
        stroke="u&#114;l(external.svg#stroke)" marker-end="url(//unsafe.invalid/marker)"
        style="fill:url(external.svg#paint);stroke:u\72l(external.svg);animation:spin 1s;stroke-width:2"/>
        <text x="1" y="10">Safe label</text></svg>"##,
    );
    let html = result["html"].as_str().unwrap();
    assert!(html.contains("<svg") && html.contains("Safe label"));
    assert!(html.contains("stroke-width:2"));
    for forbidden in [
        "<script",
        "onload",
        "onclick",
        "<foreignObject",
        "<image",
        "<use",
        "<animate",
        "<set",
        "unsafe.invalid",
        "external.svg",
        "animation:",
        "Embedded HTML",
    ] {
        assert!(!html.contains(forbidden), "Retained {forbidden}: {html}");
    }
}

#[test]
fn svg_anchors_filter_external_paint_without_losing_html_link_layout() {
    let result = snapshot(
        r##"<a href="https://github.com/owner/repo/pull/7"
        style="padding:6px 12px;display:inline-flex;text-decoration:none">HTML link</a>
        <svg viewBox="0 0 200 80"><defs><linearGradient id="shade">
        <stop offset="0%" stop-color="#fff"/></linearGradient></defs>
        <a href="https://github.com/owner/repo/pull/7"
        style="fill:url(https://unsafe.invalid/paint.svg#color);stroke:url('#shade');stroke-width:2;--remote:url(external.svg)">
        <text x="10" y="30">Linked diagram label</text></a></svg>"##,
    );
    let html = result["html"].as_str().unwrap();
    assert!(
        !html.contains("unsafe.invalid"),
        "External anchor paint survived: {html}"
    );
    assert!(!html.contains("external.svg"));
    for expected in [
        "stroke:url('#shade')",
        "stroke-width:2",
        "padding:6px 12px",
        "display:inline-flex",
        "text-decoration:none",
        "Linked diagram label",
        "HTML link",
    ] {
        assert!(html.contains(expected), "Missing {expected}: {html}");
    }
    assert_eq!(
        html.matches("href=\"https://github.com/owner/repo/pull/7\"")
            .count(),
        2
    );
}

#[test]
fn editing_only_vector_geometry_invalidates_approval() {
    let review = Review::new();
    std::fs::write(
        &review.file,
        "<svg viewBox=\"0 0 100 100\"><rect width=\"40\" height=\"40\"/></svg>",
    )
    .unwrap();
    assert!(
        review
            .command(&["open", review.file.to_str().unwrap(), "--no-browser"])
            .status
            .success()
    );
    let first = review.poll()["current_revision"]
        .as_str()
        .unwrap()
        .to_owned();
    let approve = |id: &str| json!({"id":id,"action":"approve","revision":first,"message":"","annotations":[]});
    assert_eq!(
        review
            .submit_payload(&approve("svg-current-approval"))
            .status(),
        200
    );
    std::fs::write(
        &review.file,
        "<svg viewBox=\"0 0 100 100\"><rect width=\"60\" height=\"40\"/></svg>",
    )
    .unwrap();
    assert_eq!(review.poll()["needs_review"], true);
    assert_eq!(
        review
            .submit_payload(&approve("svg-stale-approval"))
            .status(),
        409
    );
}
