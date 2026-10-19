pub const ASSETS: &[(&str, &str, &str)] = &[
    (
        "/",
        "text/html; charset=utf-8",
        include_str!("../assets/index.html"),
    ),
    (
        "/shell.js",
        "text/javascript; charset=utf-8",
        include_str!("../assets/shell.js"),
    ),
    (
        "/shell.css",
        "text/css; charset=utf-8",
        include_str!("../assets/shell.css"),
    ),
    (
        "/findings.js",
        "text/javascript; charset=utf-8",
        include_str!("../assets/findings.js"),
    ),
    (
        "/publication.js",
        "text/javascript; charset=utf-8",
        include_str!("../assets/publication.js"),
    ),
    (
        "/submission-status.js",
        "text/javascript; charset=utf-8",
        include_str!("../assets/submission-status.js"),
    ),
    (
        "/annotations.js",
        "text/javascript; charset=utf-8",
        include_str!("../assets/annotations.js"),
    ),
];
