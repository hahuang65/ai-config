use super::{Service, failure};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    revision: String,
    report_digest: String,
    edit: evaluation::report_edit::Revision,
}

pub async fn revise(
    State(service): State<Service>,
    body: std::result::Result<Json<Request>, JsonRejection>,
) -> Response {
    let Ok(Json(request)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Invalid report revision.");
    };
    let updates = service.updates.clone();
    let result = tokio::task::spawn_blocking(move || {
        service.store.lock().expect("store lock").revise_report(
            &service.paths,
            &request.report_digest,
            &request.revision,
            &request.edit,
        )
    })
    .await;
    match result {
        Ok(Ok(())) => {
            updates.send_modify(|_| {});
            Json(json!({"updated":true})).into_response()
        }
        Ok(Err(message)) => failure(StatusCode::CONFLICT, message),
        Err(_) => failure(
            StatusCode::SERVICE_UNAVAILABLE,
            "Report revision interrupted.",
        ),
    }
}
