//! Stub handlers for M0 — all gated by `AuthUser`. M4 replaces the stubs with
//! real sqlx queries against `problems_progress`.

use axum::Json;
use axum::extract::Path;

use crate::auth::middleware::AuthUser;
use crate::dto::progress::{ProgressRecord, UpsertProgressRequest};
use crate::error::AppError;

#[utoipa::path(
    get,
    path = "/api/progress",
    tag = "progress",
    security(("bearer_auth" = [])),
    responses((status = 200, body = [ProgressRecord]), (status = 401))
)]
pub async fn list(_user: AuthUser) -> Json<Vec<ProgressRecord>> {
    Json(Vec::new())
}

#[utoipa::path(
    get,
    path = "/api/progress/{slug}",
    tag = "progress",
    security(("bearer_auth" = [])),
    params(("slug" = String, Path, description = "Problem slug")),
    responses((status = 200, body = ProgressRecord), (status = 404), (status = 401))
)]
pub async fn get_one(_user: AuthUser, Path(slug): Path<String>) -> Result<Json<ProgressRecord>, AppError> {
    Err(AppError::NotFound(format!("No progress for slug '{slug}'")))
}

#[utoipa::path(
    put,
    path = "/api/progress/{slug}",
    tag = "progress",
    security(("bearer_auth" = [])),
    params(("slug" = String, Path, description = "Problem slug")),
    request_body = UpsertProgressRequest,
    responses((status = 200, body = ProgressRecord), (status = 401), (status = 501))
)]
pub async fn upsert(
    _user: AuthUser,
    Path(_slug): Path<String>,
    Json(_body): Json<UpsertProgressRequest>,
) -> Result<Json<ProgressRecord>, AppError> {
    Err(AppError::NotImplemented("progress upsert lands in M4".to_string()))
}

#[utoipa::path(
    delete,
    path = "/api/progress",
    tag = "progress",
    security(("bearer_auth" = [])),
    responses((status = 204), (status = 401), (status = 501))
)]
pub async fn reset(_user: AuthUser) -> Result<(), AppError> {
    Err(AppError::NotImplemented("progress reset lands in M4".to_string()))
}
