use crate::change_types::{Report, Severity};

pub fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

pub fn terminal(text: &str) -> String {
    text.chars()
        .map(|c| {
            if (c.is_control() && c != '\n' && c != '\t')
                || matches!(c, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
            {
                format!("\\u{{{:x}}}", c as u32)
            } else {
                c.to_string()
            }
        })
        .collect()
}

pub fn render(report: &Report) -> String {
    let mut html = String::from(HEADER);
    html.push_str(&format!("<header><h1>Change review</h1><p>{}</p><p class=badge>Risk: {:?} · {} findings</p></header>", escape(&report.summary), report.risk, report.findings.len()));
    scope(&mut html, report);
    findings(&mut html, report);
    evidence(&mut html, report);
    html
}

fn scope(html: &mut String, report: &Report) {
    let repository = report
        .display
        .as_ref()
        .map(|display| display.repository.as_str())
        .unwrap_or_else(|| {
            report
                .scope
                .repository
                .rsplit('/')
                .next()
                .unwrap_or("Repository")
        });
    let comparison = report
        .display
        .as_ref()
        .map(|display| display.comparison.as_str())
        .unwrap_or("Selected changes");
    let intent = report
        .intent_summary
        .as_deref()
        .unwrap_or("Review the selected changes.");
    html.push_str(&format!("<section><h2>Scope and intent</h2><p>{}</p><dl><dt>Repository</dt><dd>{}</dd><dt>Path scope</dt><dd>{}</dd><dt>Comparison</dt><dd>{}</dd></dl>", escape(intent), escape(repository), escape(report.scope.path_filter.as_deref().unwrap_or("All eligible source files")), escape(comparison)));
    if let Some(pr) = &report.scope.pull_request {
        html.push_str(&format!(
            "<p>Pull request: <code>{}</code></p>",
            escape(&pr.url)
        ));
    }
    html.push_str("</section>");
}

fn findings(html: &mut String, report: &Report) {
    html.push_str("<section><h2>Findings</h2>");
    if report.findings.is_empty() {
        html.push_str(
            "<p>No findings were reported. This is not proof that the change is correct.</p>",
        );
    }
    for severity in [
        Severity::Critical,
        Severity::High,
        Severity::Medium,
        Severity::Low,
    ] {
        let findings: Vec<_> = report
            .findings
            .iter()
            .filter(|finding| finding.proposal.severity == severity)
            .collect();
        if findings.is_empty() {
            continue;
        }
        html.push_str(&format!("<h3>{severity:?}</h3>"));
        for finding in findings {
            let p = &finding.proposal;
            html.push_str(&format!("<article id=\"{}\"><h4>{} · {}</h4><p class=location><code>{} · {:?} · line {}</code></p>", escape(&finding.id), escape(&finding.id), escape(&p.title), escape(&p.path), p.side, p.line.map(|n| n.to_string()).unwrap_or_else(|| "unspecified".into())));
            finding_body(html, p);
            html.push_str(&format!("<p class=location>{}</p>", p.kind.label()));
            if !finding.inline {
                html.push_str("<p class=warning>This location is not proven by an added or removed diff line. It cannot be posted as an inline comment.</p>");
            }
            html.push_str("</article>");
        }
    }
    html.push_str("</section>");
}

fn finding_body(html: &mut String, proposal: &crate::change_types::Proposal) {
    if let Some(explanation) = &proposal.explanation {
        for (heading, text) in explanation.sections() {
            html.push_str(&format!(
                "<div class=finding-section><h5>{heading}</h5><p class=prose>{}</p></div>",
                escape(text)
            ));
        }
    } else {
        // Retained body-only reports remain readable without inventing missing sections.
        html.push_str(&format!("<p class=prose>{}</p>", escape(&proposal.body)));
    }
}

fn evidence(html: &mut String, report: &Report) {
    html.push_str("<section><h2>Evidence and limits</h2><p>Tests were not run. The reviewer can read snapshot files, but cannot execute source code. Findings are reviewer claims, not verified test results.</p>");
    html.push_str(&format!("<p>Evidence was read from {} files. The full list is retained in the review record.</p><h3>Uncertainty and excluded evidence</h3><ul>", report.files_read.len()));
    for uncertainty in &report.uncertainties {
        html.push_str(&format!("<li>{}</li>", escape(uncertainty)));
    }
    html.push_str("</ul></section><footer>Publication requires a separate exact preview and human confirmation. GitHub comments never approve a pull request.</footer></main></body></html>");
}

const HEADER: &str = r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Change review</title><style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif;line-height:1.65;background:#f2f4f7;color:#182333}body{margin:0}main{max-width:920px;margin:0 auto;padding:48px 24px;overflow-wrap:anywhere}header{padding-bottom:24px;border-bottom:3px solid #3066b5}h1{font-size:2.5rem;line-height:1.2;margin:12px 0}h2{margin-top:0}h3{margin-top:28px}h4{font-size:1.1rem;margin:0 0 8px}h5{font-size:.95rem;margin:16px 0 6px}.badge{font-weight:650}section{background:white;border:1px solid #d4dce6;border-radius:12px;padding:26px;margin-top:26px}article{border-left:4px solid #3066b5;padding:18px 20px;background:#f5f7fb;margin:18px 0}.prose{white-space:pre-wrap}code{font-family:ui-monospace,monospace;font-size:.85em;overflow-wrap:anywhere}dt{font-weight:650}dd{margin:2px 0 14px;overflow-wrap:anywhere}.location,footer{font-size:.9rem;color:#48566b}.warning{border-top:1px solid #cad3e2;padding-top:12px;font-size:.9rem}footer{padding:28px 0}li{margin-bottom:8px}@media(prefers-color-scheme:dark){:root{background:#101722;color:#e1e7ee}section{background:#17212e;border-color:#354353}article{background:#202c3b}.location,footer{color:#b6c5d9}}@media(max-width:600px){main{padding:24px 14px}section{padding:20px}h1{font-size:2rem}}
</style></head><body><main>"#;
