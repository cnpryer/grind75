//! Stub handlers for M0 — all gated by `AuthUser`. M4 replaces the stubs with
//! a transactional insert (attempt + progress upsert) against Postgres.

use axum::Json;
use axum::extract::Query;
use serde::Deserialize;

use crate::auth::middleware::AuthUser;
use crate::dto::attempt::{AttemptRecord, CreateAttemptRequest};
use crate::error::AppError;

#[derive(Debug, Deserialize)]
pub struct ListAttemptsQuery {
    pub slug: Option<String>,
    pub limit: Option<u32>,
}

#[utoipa::path(
    get,
    path = "/api/attempts",
    tag = "attempts",
    security(("bearer_auth" = [])),
    params(
        ("slug" = Option<String>, Query, description = "Filter by problem slug"),
        ("limit" = Option<u32>, Query, description = "Max rows to return")
    ),
    responses((status = 200, body = [AttemptRecord]), (status = 401))
)]
pub async fn list(
    _user: AuthUser,
    Query(_q): Query<ListAttemptsQuery>,
) -> Json<Vec<AttemptRecord>> {
    Json(Vec::new())
}

#[utoipa::path(
    post,
    path = "/api/attempts",
    tag = "attempts",
    security(("bearer_auth" = [])),
    request_body = CreateAttemptRequest,
    responses((status = 201, body = AttemptRecord), (status = 401), (status = 501))
)]
pub async fn create(
    _user: AuthUser,
    Json(_body): Json<CreateAttemptRequest>,
) -> Result<Json<AttemptRecord>, AppError> {
    Err(AppError::NotImplemented(
        "attempt create lands in M4".to_string(),
    ))
}
