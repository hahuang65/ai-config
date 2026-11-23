use crate::{change_html::escape, change_types::Report};

pub fn overview(html: &mut String, report: &Report) {
    let Some(jev) = &report.jev else {
        return;
    };
    html.push_str(&format!("<section><h2>Jev advisory assistance</h2><p>Status: {}. These judgments are not approval or verified facts.</p>", escape(&jev.status)));
    let tokens: Option<u64> = jev.calls.iter().map(|call| call.input_tokens).sum();
    html.push_str(&format!("<p>{} completed classifier calls · {} reported input tokens · {} ms classifier process time. Failed requests can incur unreported usage and time. No cost or speed saving is established by these figures.</p>", jev.calls.len(), tokens.map(|value| value.to_string()).unwrap_or_else(|| "unknown".into()), jev.calls.iter().map(|call| call.elapsed_ms).sum::<u64>()));
    html.push_str("<h3>Supplemental reading priorities</h3><ol>");
    for item in &jev.context {
        html.push_str(&format!(
            "<li><code>{}</code> — relevance probability {:.2}</li>",
            escape(&item.path),
            item.probability
        ));
    }
    html.push_str("</ol><h3>Focused checklist</h3><ul>");
    for item in &jev.checklist {
        html.push_str(&format!(
            "<li>{} — relevance probability {:.2}</li>",
            escape(&item.concern),
            item.probability
        ));
    }
    for limit in &jev.limits {
        html.push_str(&format!("<li>{}</li>", escape(limit)));
    }
    html.push_str("</ul></section>");
}

pub fn finding(html: &mut String, report: &Report, id: &str) {
    let Some(check) = report
        .jev
        .as_ref()
        .and_then(|jev| jev.findings.iter().find(|check| check.finding_id == id))
    else {
        return;
    };
    let value = |p: Option<f64>| {
        p.map(|value| format!("{value:.2}"))
            .unwrap_or_else(|| "not assessed".into())
    };
    html.push_str(&format!("<div class=finding-section><h5>Jev advisory assessment</h5><p>Status: {}. Evidence support: {}; introduced by change: {}. These probabilities do not remove the finding or authorize any action.</p>", escape(&check.status), value(check.supported), value(check.introduced)));
    for duplicate in &check.duplicates {
        html.push_str(&format!("<p>Possible duplicate of {}: probability {:.2}. Both findings remain available for human decisions.</p>", escape(&duplicate.finding_id), duplicate.probability));
    }
    html.push_str("</div>");
}
