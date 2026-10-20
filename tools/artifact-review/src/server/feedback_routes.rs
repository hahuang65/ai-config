use super::{Service, failure};
use crate::feedback::{Finish, Lease, Origin};
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;

pub async fn status(State(service): State<Service>) -> Response {
    let result = service
        .store
        .lock()
        .expect("store lock")
        .feedback_processing();
    match result {
        Ok(processing) => Json(processing).into_response(),
        Err(message) => failure(StatusCode::SERVICE_UNAVAILABLE, message),
    }
}

pub async fn attach(
    State(service): State<Service>,
    body: std::result::Result<Json<Origin>, JsonRejection>,
) -> Response {
    let Ok(Json(origin)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Invalid feedback origin.");
    };
    let result = service
        .store
        .lock()
        .expect("store lock")
        .attach_feedback(&service.paths, origin);
    match result {
        Ok(()) => {
            service.updates.send_modify(|_| {});
            Json(json!({"attached":true})).into_response()
        }
        Err(message) => failure(StatusCode::CONFLICT, message),
    }
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Attachment {
    origin: Origin,
    ticket: String,
}

pub async fn ticket(State(service): State<Service>) -> Response {
    perform(service, |store, _| {
        Ok(json!({"ticket":store.feedback_ticket()?}))
    })
}

pub async fn attach_ticket(
    State(service): State<Service>,
    body: std::result::Result<Json<Attachment>, JsonRejection>,
) -> Response {
    let Ok(Json(attachment)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Invalid attachment receipt.");
    };
    perform(service, move |store, paths| {
        store.attach_feedback_with_ticket(paths, attachment.origin, Some(&attachment.ticket))?;
        Ok(json!({"attached":true}))
    })
}

pub async fn inbox(
    State(service): State<Service>,
    body: std::result::Result<Json<Origin>, JsonRejection>,
) -> Response {
    let Ok(Json(origin)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Invalid feedback origin.");
    };
    perform(service, move |store, paths| {
        serde_json::to_value(store.feedback_inbox(paths, origin)?)
            .map_err(|_| "Cannot encode feedback inbox.")
    })
}

pub async fn pending(
    State(service): State<Service>,
    body: std::result::Result<Json<Origin>, JsonRejection>,
) -> Response {
    let Ok(Json(origin)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Invalid feedback origin.");
    };
    perform(service, move |store, paths| {
        serde_json::to_value(store.pending_feedback(paths, origin)?)
            .map_err(|_| "Cannot encode pending feedback.")
    })
}

pub async fn claim(
    State(service): State<Service>,
    body: std::result::Result<Json<Origin>, JsonRejection>,
) -> Response {
    let Ok(Json(origin)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Invalid feedback origin.");
    };
    perform(service, move |store, paths| {
        serde_json::to_value(store.claim_feedback(paths, origin)?)
            .map_err(|_| "Cannot encode feedback claim.")
    })
}

pub async fn renew(
    State(service): State<Service>,
    body: std::result::Result<Json<Lease>, JsonRejection>,
) -> Response {
    let Ok(Json(lease)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Invalid feedback lease.");
    };
    perform(service, move |store, _| {
        store.renew_feedback(&lease)?;
        Ok(json!({"renewed":true}))
    })
}

pub async fn fail(
    State(service): State<Service>,
    body: std::result::Result<Json<Lease>, JsonRejection>,
) -> Response {
    let Ok(Json(lease)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Invalid feedback lease.");
    };
    perform(service, move |store, _| {
        store.fail_feedback(&lease)?;
        Ok(json!({"retained":true}))
    })
}

pub async fn finish(
    State(service): State<Service>,
    body: std::result::Result<Json<Finish>, JsonRejection>,
) -> Response {
    let Ok(Json(finish)) = body else {
        return failure(StatusCode::BAD_REQUEST, "Invalid feedback completion.");
    };
    perform(service, move |store, paths| {
        Ok(json!({"cursor":store.finish_feedback(paths, finish)?}))
    })
}

fn perform(
    service: Service,
    action: impl FnOnce(
        &mut crate::store::Store,
        &crate::paths::Paths,
    ) -> crate::paths::Result<serde_json::Value>,
) -> Response {
    let result = action(
        &mut service.store.lock().expect("store lock"),
        &service.paths,
    );
    match result {
        Ok(value) => {
            service.updates.send_modify(|_| {});
            Json(value).into_response()
        }
        Err(message) => failure(StatusCode::CONFLICT, message),
    }
}
