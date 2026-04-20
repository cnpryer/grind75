use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use sqlx::PgPool;

use crate::AppState;
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
pub async fn list(
    _user: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<Vec<ProgressRecord>>, AppError> {
    // Pre-aggregate `attempts` once with a GROUP BY, then LEFT JOIN — a single
    // pass instead of N correlated subqueries when the dashboard has many slugs.
    let rows = sqlx::query_as::<_, ProgressRecord>(
        "SELECT p.slug, p.status, p.last_code, p.notes, p.attempt_count, p.solved_at, p.updated_at, \
                COALESCE(a.total_elapsed_ms, 0)::bigint AS total_elapsed_ms \
         FROM problems_progress p \
         LEFT JOIN ( \
             SELECT slug, SUM(elapsed_ms) AS total_elapsed_ms \
             FROM attempts \
             GROUP BY slug \
         ) a ON a.slug = p.slug \
         ORDER BY p.updated_at DESC",
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
}

#[utoipa::path(
    get,
    path = "/api/progress/{slug}",
    tag = "progress",
    security(("bearer_auth" = [])),
    params(("slug" = String, Path, description = "Problem slug")),
    responses((status = 200, body = ProgressRecord), (status = 404), (status = 401))
)]
pub async fn get_one(
    _user: AuthUser,
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<ProgressRecord>, AppError> {
    let row = sqlx::query_as::<_, ProgressRecord>(
        "SELECT p.slug, p.status, p.last_code, p.notes, p.attempt_count, p.solved_at, p.updated_at, \
                COALESCE((SELECT SUM(a.elapsed_ms) FROM attempts a WHERE a.slug = p.slug), 0)::bigint AS total_elapsed_ms \
         FROM problems_progress p WHERE p.slug = $1",
    )
    .bind(&slug)
    .fetch_optional(&state.pool)
    .await?;

    match row {
        Some(progress) => Ok(Json(progress)),
        None => Err(AppError::NotFound(format!("No progress for slug '{slug}'"))),
    }
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
    State(state): State<AppState>,
    Path(slug): Path<String>,
    Json(body): Json<UpsertProgressRequest>,
) -> Result<Json<ProgressRecord>, AppError> {
    if body.status.is_none() && body.last_code.is_none() && body.notes.is_none() {
        return Err(AppError::BadRequest(
            "At least one of status, last_code, or notes must be provided".to_string(),
        ));
    }

    let row = sqlx::query_as::<_, ProgressRecord>(
        "INSERT INTO problems_progress (slug, status, last_code, notes, solved_at, updated_at)
         VALUES (
             $1,
             COALESCE($2::progress_status, 'not_started'::progress_status),
             $3,
             $4,
             CASE
                 WHEN COALESCE($2::progress_status, 'not_started'::progress_status) = 'solved'::progress_status
                     THEN NOW()
                 ELSE NULL
             END,
             NOW()
         )
         ON CONFLICT (slug) DO UPDATE SET
             status = COALESCE($2::progress_status, problems_progress.status),
             last_code = COALESCE($3, problems_progress.last_code),
             notes = COALESCE($4, problems_progress.notes),
             solved_at = CASE
                 WHEN COALESCE($2::progress_status, problems_progress.status) = 'solved'::progress_status
                     THEN COALESCE(problems_progress.solved_at, NOW())
                 ELSE problems_progress.solved_at
             END,
             updated_at = NOW()
         RETURNING slug, status, last_code, notes, attempt_count, solved_at, updated_at, \
                   COALESCE((SELECT SUM(a.elapsed_ms) FROM attempts a WHERE a.slug = $1), 0)::bigint AS total_elapsed_ms",
    )
    .bind(&slug)
    .bind(body.status)
    .bind(body.last_code)
    .bind(body.notes)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(row))
}

/// Flip a `solved` problem back to `attempted` so the user can lap it again.
/// No-op (returns the existing row) when status is already not `solved`.
#[utoipa::path(
    post,
    path = "/api/progress/{slug}/unsolve",
    tag = "progress",
    security(("bearer_auth" = [])),
    params(("slug" = String, Path, description = "Problem slug")),
    responses((status = 200, body = ProgressRecord), (status = 404), (status = 401))
)]
pub async fn unsolve(
    _user: AuthUser,
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<ProgressRecord>, AppError> {
    let updated = sqlx::query_as::<_, ProgressRecord>(
        "UPDATE problems_progress
         SET status = 'attempted'::progress_status,
             solved_at = NULL,
             updated_at = NOW()
         WHERE slug = $1
           AND status = 'solved'::progress_status
         RETURNING slug, status, last_code, notes, attempt_count, solved_at, updated_at, \
                   COALESCE((SELECT SUM(a.elapsed_ms) FROM attempts a WHERE a.slug = $1), 0)::bigint AS total_elapsed_ms",
    )
    .bind(&slug)
    .fetch_optional(&state.pool)
    .await?;

    if let Some(progress) = updated {
        return Ok(Json(progress));
    }

    let existing = sqlx::query_as::<_, ProgressRecord>(
        "SELECT p.slug, p.status, p.last_code, p.notes, p.attempt_count, p.solved_at, p.updated_at, \
                COALESCE((SELECT SUM(a.elapsed_ms) FROM attempts a WHERE a.slug = p.slug), 0)::bigint AS total_elapsed_ms \
         FROM problems_progress p WHERE p.slug = $1",
    )
    .bind(&slug)
    .fetch_optional(&state.pool)
    .await?;

    match existing {
        Some(progress) => Ok(Json(progress)),
        None => Err(AppError::NotFound(format!("No progress for slug '{slug}'"))),
    }
}

#[utoipa::path(
    delete,
    path = "/api/progress",
    tag = "progress",
    security(("bearer_auth" = [])),
    responses((status = 204), (status = 401), (status = 501))
)]
pub async fn reset(_user: AuthUser, State(pool): State<PgPool>) -> Result<StatusCode, AppError> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM attempts")
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM problems_progress")
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    Ok(StatusCode::NO_CONTENT)
}
