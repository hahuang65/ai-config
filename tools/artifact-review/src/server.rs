use crate::model::{Submission, snapshot};
use crate::paths::{Descriptor, Paths, Result, private_file};
use crate::store::Store;
use axum::extract::{DefaultBodyLimit, Request, State};
use axum::http::{HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use fs2::FileExt;
use serde_json::json;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::Notify;
use tower_http::timeout::TimeoutLayer;

const MAX_BODY: usize = 128 * 1024;
const POLICY: &str = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

#[derive(Clone)]
struct Service {
    paths: Paths,
    store: Arc<Mutex<Store>>,
    capability: String,
    origin: String,
    host: String,
    shutdown: Arc<Notify>,
}

pub async fn serve(paths: Paths) -> Result<()> {
    let lock = private_file(&paths.directory.join("server.lock"))?;
    if lock.try_lock_exclusive().is_err() {
        return Ok(());
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|_| "Cannot bind local review server.")?;
    let port = listener
        .local_addr()
        .map_err(|_| "Cannot read local server port.")?
        .port();
    let capability = format!(
        "{:032x}{:032x}",
        rand::random::<u128>(),
        rand::random::<u128>()
    );
    let shutdown = Arc::new(Notify::new());
    let service = Service {
        store: Arc::new(Mutex::new(Store::open(&paths)?)),
        paths: paths.clone(),
        capability: capability.clone(),
        origin: format!("http://127.0.0.1:{port}"),
        host: format!("127.0.0.1:{port}"),
        shutdown: shutdown.clone(),
    };
    paths.save_descriptor(&Descriptor {
        pid: std::process::id(),
        port,
        capability,
    })?;
    let app = routes()
        .layer(DefaultBodyLimit::max(MAX_BODY))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(5),
        ))
        .layer(middleware::from_fn_with_state(service.clone(), boundary))
        .with_state(service);
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            tokio::select! { _ = shutdown.notified() => {}, _ = tokio::signal::ctrl_c() => {} }
        })
        .await
        .map_err(|_| "Review server stopped unexpectedly.")?;
    let _ = std::fs::remove_file(paths.directory.join("server.json"));
    Ok(())
}

const ASSETS: &[(&str, &str, &str)] = &[
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
        "/annotations.js",
        "text/javascript; charset=utf-8",
        include_str!("../assets/annotations.js"),
    ),
];

fn routes() -> Router<Service> {
    let mut router = Router::new();
    for &(path, content_type, source) in ASSETS {
        router = router.route(
            path,
            get(move || async move { asset(content_type, source) }),
        );
    }
    router
        .route("/snapshot", get(read_snapshot))
        .route("/events", get(events))
        .route("/submit", post(submit))
        .route("/findings", post(configure_findings))
        .route("/reopen", post(reopen))
        .route("/stop", post(stop))
}

fn asset(content_type: &'static str, source: &'static str) -> Response {
    ([("content-type", content_type)], source).into_response()
}

fn authorize(
    service: &Service,
    request: &Request,
) -> std::result::Result<(), (StatusCode, &'static str)> {
    let header = |name| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
    };
    if header("host") != Some(service.host.as_str()) {
        return Err((StatusCode::FORBIDDEN, "Invalid local host."));
    }
    if header("origin").is_some_and(|origin| origin != service.origin) {
        return Err((StatusCode::FORBIDDEN, "Origin is not allowed."));
    }
    let public = ASSETS
        .iter()
        .any(|(path, _, _)| *path == request.uri().path());
    let authorized =
        header("authorization") == Some(format!("Bearer {}", service.capability).as_str());
    if !public && !authorized {
        return Err((
            StatusCode::UNAUTHORIZED,
            "Session authorization is required.",
        ));
    }
    if request.method() == "POST" && header("origin") != Some(service.origin.as_str()) {
        return Err((StatusCode::FORBIDDEN, "Local origin is required."));
    }
    if request.uri().query().is_some() && request.uri().path() != "/events" {
        return Err((StatusCode::BAD_REQUEST, "Unexpected query parameters."));
    }
    Ok(())
}

async fn boundary(State(service): State<Service>, request: Request, next: Next) -> Response {
    if let Err((status, message)) = authorize(&service, &request) {
        return failure(status, message);
    }
    let mut response = next.run(request).await;
    for (name, value) in [
        ("content-security-policy", POLICY),
        ("cache-control", "no-store"),
        ("referrer-policy", "no-referrer"),
        ("x-content-type-options", "nosniff"),
        ("x-frame-options", "DENY"),
    ] {
        response
            .headers_mut()
            .insert(name, HeaderValue::from_static(value));
    }
    response
}

async fn read_snapshot(State(service): State<Service>) -> Response {
    let snapshot = tokio::task::spawn_blocking(move || snapshot(&service.paths)).await;
    match snapshot {
        Ok(Ok(snapshot)) => Json(snapshot).into_response(),
        _ => failure(
            StatusCode::SERVICE_UNAVAILABLE,
            "Cannot load artifact. Approval is unavailable.",
        ),
    }
}

async fn events(State(service): State<Service>, request: Request) -> Response {
    let query = request.uri().query().unwrap_or("cursor=0");
    let Some(cursor) = query
        .strip_prefix("cursor=")
        .and_then(|value| value.parse::<u64>().ok())
    else {
        return failure(StatusCode::BAD_REQUEST, "Use one unsigned cursor.");
    };
    let page = tokio::task::spawn_blocking(move || {
        service
            .store
            .lock()
            .expect("store lock")
            .page(cursor, &service.paths)
    })
    .await;
    match page {
        Ok(Ok(page)) => Json(page).into_response(),
        Ok(Err(message)) => failure(StatusCode::BAD_REQUEST, message),
        Err(_) => failure(
            StatusCode::SERVICE_UNAVAILABLE,
            "Cannot read review status.",
        ),
    }
}

async fn submit(
    State(service): State<Service>,
    body: std::result::Result<Json<Submission>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let submission = match body {
        Ok(Json(submission)) => submission,
        Err(error) if error.status() == StatusCode::PAYLOAD_TOO_LARGE => {
            return failure(StatusCode::PAYLOAD_TOO_LARGE, "Feedback is too large.");
        }
        Err(_) => return failure(StatusCode::BAD_REQUEST, "Invalid feedback fields."),
    };
    if let Err(message) = submission.validate() {
        return failure(StatusCode::BAD_REQUEST, message);
    }
    match service
        .store
        .lock()
        .expect("store lock")
        .submit(&service.paths, &submission)
    {
        Ok(cursor) => Json(json!({"cursor": cursor})).into_response(),
        Err(message) => failure(StatusCode::CONFLICT, message),
    }
}

async fn configure_findings(
    State(service): State<Service>,
    body: std::result::Result<
        Json<crate::findings::Binding>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Response {
    let Ok(Json(binding)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Invalid finding configuration.");
    };
    match service
        .store
        .lock()
        .expect("store lock")
        .configure_findings(&service.paths, &binding)
    {
        Ok(()) => Json(json!({"status": "configured"})).into_response(),
        Err(message) => failure(StatusCode::CONFLICT, message),
    }
}

async fn reopen(State(service): State<Service>) -> Response {
    match service.store.lock().expect("store lock").reopen() {
        Ok(()) => Json(json!({"status": "open"})).into_response(),
        Err(message) => failure(StatusCode::CONFLICT, message),
    }
}

async fn stop(State(service): State<Service>) -> Response {
    service.shutdown.notify_one();
    Json(json!({"status": "stopped"})).into_response()
}

fn failure(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({"error": message}))).into_response()
}
