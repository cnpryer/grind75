use axum::Json;
use axum::extract::State;

use crate::AppState;
use crate::auth::middleware::AuthUser;
use crate::dto::settings::{SettingsRecord, UpdateSettingsRequest};
use crate::error::AppError;

#[utoipa::path(
    get,
    path = "/api/settings",
    tag = "settings",
    security(("bearer_auth" = [])),
    responses((status = 200, body = SettingsRecord), (status = 401))
)]
pub async fn read(
    _user: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<SettingsRecord>, AppError> {
    let row = sqlx::query_as::<_, SettingsRecord>(
        "SELECT auto_start_timer, updated_at FROM user_settings WHERE id = 1",
    )
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(row))
}

#[utoipa::path(
    put,
    path = "/api/settings",
    tag = "settings",
    security(("bearer_auth" = [])),
    request_body = UpdateSettingsRequest,
    responses(
        (status = 200, body = SettingsRecord),
        (status = 400),
        (status = 401)
    )
)]
pub async fn update(
    _user: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<UpdateSettingsRequest>,
) -> Result<Json<SettingsRecord>, AppError> {
    if body.auto_start_timer.is_none() {
        return Err(AppError::BadRequest(
            "At least one setting must be provided".to_string(),
        ));
    }

    // COALESCE lets the same query handle partial updates once we grow beyond
    // the single `auto_start_timer` field.
    let row = sqlx::query_as::<_, SettingsRecord>(
        "UPDATE user_settings
         SET auto_start_timer = COALESCE($1, auto_start_timer),
             updated_at = NOW()
         WHERE id = 1
         RETURNING auto_start_timer, updated_at",
    )
    .bind(body.auto_start_timer)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(row))
}
