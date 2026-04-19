use axum::Json;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use serde::Deserialize;

use crate::AppState;
use crate::auth::middleware::AuthUser;
use crate::dto::attempt::{AttemptRecord, CreateAttemptRequest, HeatmapCell};
use crate::error::AppError;

#[derive(Debug, Deserialize)]
pub struct ListAttemptsQuery {
    pub slug: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct HeatmapQuery {
    pub days: Option<u32>,
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
    State(state): State<AppState>,
    Query(q): Query<ListAttemptsQuery>,
) -> Result<Json<Vec<AttemptRecord>>, AppError> {
    let limit = q.limit.unwrap_or(50).clamp(1, 200) as i64;
    let rows = sqlx::query_as::<_, AttemptRecord>(
        "SELECT id, slug, code, passed, duration_ms, elapsed_ms, pytest_summary, created_at
         FROM attempts
         WHERE ($1::text IS NULL OR slug = $1)
         ORDER BY created_at DESC
         LIMIT $2",
    )
    .bind(q.slug)
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows))
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
    State(state): State<AppState>,
    Json(body): Json<CreateAttemptRequest>,
) -> Result<(StatusCode, Json<AttemptRecord>), AppError> {
    if body.slug.trim().is_empty() {
        return Err(AppError::Validation("slug is required".to_string()));
    }
    if body.code.trim().is_empty() {
        return Err(AppError::Validation("code is required".to_string()));
    }
    if body.duration_ms < 0 {
        return Err(AppError::Validation(
            "duration_ms must be non-negative".to_string(),
        ));
    }
    if body.elapsed_ms < 0 {
        return Err(AppError::Validation(
            "elapsed_ms must be non-negative".to_string(),
        ));
    }

    let mut tx = state.pool.begin().await?;

    let attempt = sqlx::query_as::<_, AttemptRecord>(
        "INSERT INTO attempts (slug, code, passed, duration_ms, elapsed_ms, pytest_summary)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, slug, code, passed, duration_ms, elapsed_ms, pytest_summary, created_at",
    )
    .bind(&body.slug)
    .bind(&body.code)
    .bind(body.passed)
    .bind(body.duration_ms)
    .bind(body.elapsed_ms)
    .bind(&body.pytest_summary)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO problems_progress (slug, status, last_code, attempt_count, solved_at, updated_at)
         VALUES (
             $1,
             CASE
                 WHEN $2 THEN 'solved'::progress_status
                 ELSE 'attempted'::progress_status
             END,
             $3,
             1,
             CASE WHEN $2 THEN NOW() ELSE NULL END,
             NOW()
         )
         ON CONFLICT (slug) DO UPDATE SET
             status = CASE
                 WHEN EXCLUDED.status = 'solved'::progress_status
                      OR problems_progress.status = 'solved'::progress_status
                     THEN 'solved'::progress_status
                 ELSE 'attempted'::progress_status
             END,
             last_code = EXCLUDED.last_code,
             attempt_count = problems_progress.attempt_count + 1,
             solved_at = CASE
                 WHEN EXCLUDED.status = 'solved'::progress_status
                     THEN COALESCE(problems_progress.solved_at, NOW())
                 ELSE problems_progress.solved_at
             END,
             updated_at = NOW()",
    )
    .bind(&body.slug)
    .bind(body.passed)
    .bind(&body.code)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok((StatusCode::CREATED, Json(attempt)))
}

#[utoipa::path(
    get,
    path = "/api/attempts/heatmap",
    tag = "attempts",
    security(("bearer_auth" = [])),
    params(
        ("days" = Option<u32>, Query, description = "Window size in days (default 365, max 730)")
    ),
    responses((status = 200, body = [HeatmapCell]), (status = 401))
)]
pub async fn heatmap(
    _user: AuthUser,
    State(state): State<AppState>,
    Query(q): Query<HeatmapQuery>,
) -> Result<Json<Vec<HeatmapCell>>, AppError> {
    let days = q.days.unwrap_or(365).clamp(1, 730) as i32;
    let rows = sqlx::query_as::<_, (chrono::NaiveDate, i64)>(
        "SELECT (created_at AT TIME ZONE 'UTC')::date AS day,
                COUNT(*)::bigint AS count
         FROM attempts
         WHERE created_at >= NOW() - make_interval(days => $1)
         GROUP BY day
         ORDER BY day",
    )
    .bind(days)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(
        rows.into_iter()
            .map(|(date, count)| HeatmapCell { date, count })
            .collect(),
    ))
}
