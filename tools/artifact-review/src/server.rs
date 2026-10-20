mod feedback_routes;
mod report_update;
mod setup;
mod standalone;

use crate::assets::ASSETS;
use crate::model::{Submission, snapshot};
use crate::paths::{Paths, Result, private_file};
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
use tokio::sync::{Notify, watch};
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
    updates: watch::Sender<bool>,
}

pub async fn serve(paths: Paths) -> Result<()> {
    let lock = private_file(&paths.directory.join("server.lock"))?;
    if lock.try_lock_exclusive().is_err() {
        return Ok(());
    }
    let (listener, service) = setup::prepare(&paths).await?;
    let shutdown = service.shutdown.clone();
    let updates = service.updates.clone();
    let mut termination = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .map_err(|_| "Cannot observe server shutdown.")?;
    let responder = tokio::spawn(standalone::run(service.clone()));
    let app = routes()
        .layer(DefaultBodyLimit::max(MAX_BODY))
        .layer(middleware::from_fn_with_state(service.clone(), boundary))
        .with_state(service);
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            tokio::select! { _ = shutdown.notified() => {}, _ = tokio::signal::ctrl_c() => {}, _ = termination.recv() => {} }
            updates.send_replace(true);
        })
        .await
        .map_err(|_| "Review server stopped unexpectedly.")?;
    let _ = responder.await;
    let _ = std::fs::remove_file(paths.directory.join("server.json"));
    Ok(())
}

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
        .route("/processing", get(feedback_routes::status))
        .route("/revision", get(read_revision))
        .route("/submit", post(submit))
        .route("/findings", post(configure_findings))
        .route("/feedback/standalone", post(standalone::configure))
        .route("/feedback/retry", post(standalone::retry))
        .route("/feedback/revise", post(report_update::revise))
        .route("/feedback/attach", post(feedback_routes::attach))
        .route(
            "/feedback/attach-ticket",
            post(feedback_routes::attach_ticket),
        )
        .route("/feedback/ticket", post(feedback_routes::ticket))
        .route("/feedback/claim", post(feedback_routes::claim))
        .route("/feedback/pending", post(feedback_routes::pending))
        .route("/feedback/inbox", post(feedback_routes::inbox))
        .route("/feedback/renew", post(feedback_routes::renew))
        .route("/feedback/finish", post(feedback_routes::finish))
        .route("/feedback/fail", post(feedback_routes::fail))
        .route("/reopen", post(reopen))
        .route("/stop", post(stop))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(5),
        ))
        .route("/publication", get(publication_information))
        .route(
            "/publication/preview",
            post(publication_preview).layer(DefaultBodyLimit::max(1024 * 1024)),
        )
        .route("/publication/confirm", post(publication_confirm))
        .route("/publication/reconcile", post(publication_reconcile))
        .route_layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(180),
        ))
        .route(
            "/events",
            get(events).layer(TimeoutLayer::with_status_code(
                StatusCode::REQUEST_TIMEOUT,
                Duration::from_millis(crate::event_wait::MAX_WAIT_MS) + Duration::from_secs(5),
            )),
        )
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

async fn read_revision(State(service): State<Service>) -> Response {
    let revision =
        tokio::task::spawn_blocking(move || crate::model::revision(&service.paths)).await;
    match revision {
        Ok(Ok(revision)) => Json(json!({"revision": revision})).into_response(),
        _ => failure(
            StatusCode::SERVICE_UNAVAILABLE,
            "Cannot load artifact. Approval is unavailable.",
        ),
    }
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
    let (cursor, duration) = match crate::event_wait::query(request.uri().query()) {
        Ok(query) => query,
        Err(message) => return failure(StatusCode::BAD_REQUEST, message),
    };
    match tokio::time::timeout(
        duration + Duration::from_secs(5),
        event_page(service, cursor, duration),
    )
    .await
    {
        Ok(response) => response,
        Err(_) => failure(StatusCode::REQUEST_TIMEOUT, "Review request timed out."),
    }
}

async fn event_page(service: Service, cursor: u64, duration: Duration) -> Response {
    if let Err(message) = crate::event_wait::wait(
        service.store.clone(),
        service.updates.subscribe(),
        cursor,
        duration,
    )
    .await
    {
        return failure(StatusCode::BAD_REQUEST, message);
    }
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
        Ok(cursor) => {
            service.updates.send_modify(|_| {});
            Json(json!({"cursor": cursor})).into_response()
        }
        Err(message) => failure(StatusCode::CONFLICT, message),
    }
}

async fn publication_reconcile(State(service): State<Service>) -> Response {
    publication_action(service, crate::publication::Action::Reconcile).await
}

async fn publication_information(State(service): State<Service>) -> Response {
    publication_action(service, crate::publication::Action::Information).await
}

async fn publication_preview(
    State(service): State<Service>,
    body: std::result::Result<
        Json<crate::publication::Selection>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Response {
    let Ok(Json(selection)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Invalid publication selection.");
    };
    publication_action(service, crate::publication::Action::Preview(selection)).await
}

async fn publication_confirm(
    State(service): State<Service>,
    body: std::result::Result<
        Json<crate::publication::Confirmation>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Response {
    let Ok(Json(confirmation)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Invalid publication confirmation.");
    };
    publication_action(
        service,
        crate::publication::Action::Confirm(confirmation.token),
    )
    .await
}

async fn publication_action(service: Service, action: crate::publication::Action) -> Response {
    match tokio::task::spawn_blocking(move || {
        crate::publication::execute(&service.paths, &service.store, action)
    })
    .await
    {
        Ok(Ok(result)) => Json(result).into_response(),
        Ok(Err(message)) => failure(StatusCode::CONFLICT, message),
        Err(_) => failure(
            StatusCode::SERVICE_UNAVAILABLE,
            "Cannot process publication request.",
        ),
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
        Ok(()) => {
            service.updates.send_modify(|_| {});
            Json(json!({"status": "configured"})).into_response()
        }
        Err(message) => failure(StatusCode::CONFLICT, message),
    }
}

async fn reopen(State(service): State<Service>) -> Response {
    match service.store.lock().expect("store lock").reopen() {
        Ok(()) => {
            service.updates.send_modify(|_| {});
            Json(json!({"status": "open"})).into_response()
        }
        Err(message) => failure(StatusCode::CONFLICT, message),
    }
}

async fn stop(State(service): State<Service>) -> Response {
    service.updates.send_replace(true);
    service.shutdown.notify_one();
    Json(json!({"status": "stopped"})).into_response()
}

fn failure(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({"error": message}))).into_response()
}
