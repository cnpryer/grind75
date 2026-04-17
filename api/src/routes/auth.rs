use std::net::SocketAddr;

use axum::Json;
use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, StatusCode};
use chrono::{DateTime, Duration, Utc};
use ipnetwork::IpNetwork;
use uuid::Uuid;

use crate::AppState;
use crate::auth::middleware::AuthUser;
use crate::auth::{jwt, password};
use crate::dto::auth::{AuthResponse, LoginRequest, LogoutRequest, RefreshRequest, UserProfile};
use crate::error::{AppError, AuthErrorCode};

/// Request metadata captured for the `refresh_tokens` audit columns and for
/// structured auth logs. Best-effort: both fields may be `None`.
#[derive(Debug, Default, Clone)]
struct RequestMeta {
    ip: Option<IpNetwork>,
    user_agent: Option<String>,
}

fn request_meta(headers: &HeaderMap, connect_info: Option<SocketAddr>) -> RequestMeta {
    let ip = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .map(str::trim)
        .and_then(|s| s.parse::<std::net::IpAddr>().ok())
        .or_else(|| connect_info.map(|s| s.ip()))
        .map(IpNetwork::from);

    let user_agent = headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.chars().take(512).collect::<String>());

    RequestMeta { ip, user_agent }
}

#[utoipa::path(
    post,
    path = "/api/auth/login",
    request_body = LoginRequest,
    responses(
        (status = 200, description = "Login successful", body = AuthResponse),
        (status = 401, description = "Invalid credentials"),
        (status = 429, description = "Too many attempts")
    ),
    tag = "auth"
)]
pub async fn login(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    let meta = request_meta(&headers, Some(addr));

    let username_matches = req.username == state.config.admin_username;
    let password_valid = password::verify_password(&req.password, &state.config.admin_password_hash)?;

    if !username_matches || !password_valid {
        tracing::warn!(
            attempted_username = %req.username,
            ip = ?meta.ip,
            user_agent = ?meta.user_agent,
            "login failed"
        );
        return Err(AppError::Auth(AuthErrorCode::CredentialsInvalid));
    }

    let pair = issue_pair(&state, &req.username, &meta).await?;

    tracing::info!(
        username = %req.username,
        ip = ?meta.ip,
        "login ok"
    );

    Ok(Json(pair))
}

#[utoipa::path(
    post,
    path = "/api/auth/refresh",
    request_body = RefreshRequest,
    responses(
        (status = 200, description = "Token rotated", body = AuthResponse),
        (status = 401, description = "Invalid, expired, or revoked refresh token")
    ),
    tag = "auth"
)]
pub async fn refresh(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<RefreshRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    let meta = request_meta(&headers, Some(addr));

    let claims = jwt::decode_refresh(&req.refresh_token, &state.config.jwt_secret)?;
    let jti = claims.jti;

    // Look up the row; `revoked_at IS NULL` ⇒ usable, any other state ⇒ error path below.
    let row = sqlx::query_as::<_, RefreshTokenRow>(
        "SELECT jti, username, expires_at, revoked_at FROM refresh_tokens WHERE jti = $1",
    )
    .bind(jti)
    .fetch_optional(&state.pool)
    .await?;

    let row = match row {
        Some(r) => r,
        None => {
            tracing::warn!(
                jti = %jti,
                ip = ?meta.ip,
                user_agent = ?meta.user_agent,
                "refresh token not found (forged or never-issued jti)"
            );
            return Err(AppError::Auth(AuthErrorCode::RefreshInvalid));
        }
    };

    if row.username != claims.sub {
        tracing::error!(
            jti = %jti,
            claim_sub = %claims.sub,
            row_username = %row.username,
            "refresh jti/sub mismatch — forged token"
        );
        return Err(AppError::Auth(AuthErrorCode::RefreshInvalid));
    }

    if let Some(revoked_at) = row.revoked_at {
        // Replay of a revoked token — treat as theft. OAuth2 BCP: revoke
        // every active token for this user, forcing a full re-login.
        tracing::error!(
            jti = %jti,
            username = %row.username,
            revoked_at = %revoked_at,
            ip = ?meta.ip,
            user_agent = ?meta.user_agent,
            "theft signal: revoked refresh token replayed — killing chain"
        );
        sqlx::query(
            "UPDATE refresh_tokens SET revoked_at = NOW() WHERE username = $1 AND revoked_at IS NULL",
        )
        .bind(&row.username)
        .execute(&state.pool)
        .await?;
        return Err(AppError::Auth(AuthErrorCode::RefreshRevoked));
    }

    if row.expires_at <= Utc::now() {
        return Err(AppError::Auth(AuthErrorCode::RefreshExpired));
    }

    // Rotate: mint new pair, insert new row, link old → new, revoke old.
    let access_ttl = state.config.access_token_ttl_secs;
    let refresh_ttl = state.config.refresh_token_ttl_secs;

    let (access_token, _) = jwt::issue_access(&row.username, &state.config.jwt_secret, access_ttl)?;
    let (refresh_token, new_jti) =
        jwt::issue_refresh(&row.username, &state.config.jwt_secret, refresh_ttl)?;
    let new_expires_at = Utc::now() + Duration::seconds(refresh_ttl as i64);

    let mut tx = state.pool.begin().await?;

    sqlx::query(
        "INSERT INTO refresh_tokens (jti, username, expires_at, user_agent, ip) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(new_jti)
    .bind(&row.username)
    .bind(new_expires_at)
    .bind(meta.user_agent.as_deref())
    .bind(meta.ip)
    .execute(&mut *tx)
    .await?;

    sqlx::query("UPDATE refresh_tokens SET revoked_at = NOW(), replaced_by = $1 WHERE jti = $2")
        .bind(new_jti)
        .bind(jti)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    // Lazy cleanup of long-expired rows (see PLAN.md — no cron).
    let _ = sqlx::query(
        "DELETE FROM refresh_tokens WHERE expires_at < NOW() - INTERVAL '7 days'",
    )
    .execute(&state.pool)
    .await;

    tracing::info!(
        username = %row.username,
        old_jti = %jti,
        new_jti = %new_jti,
        "refresh rotated"
    );

    Ok(Json(AuthResponse {
        access_token,
        refresh_token,
        user: UserProfile { username: row.username },
    }))
}

#[utoipa::path(
    post,
    path = "/api/auth/logout",
    request_body = LogoutRequest,
    responses((status = 204, description = "Logged out")),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
pub async fn logout(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(req): Json<LogoutRequest>,
) -> Result<StatusCode, AppError> {
    // Decode best-effort: logging out an already-expired token still clears
    // whatever row matches the jti. If the token is malformed, silently no-op
    // (the access token proved the caller is authenticated).
    if let Ok(claims) = jwt::decode_refresh(&req.refresh_token, &state.config.jwt_secret) {
        sqlx::query(
            "UPDATE refresh_tokens SET revoked_at = NOW() \
             WHERE jti = $1 AND username = $2 AND revoked_at IS NULL",
        )
        .bind(claims.jti)
        .bind(&auth_user.username)
        .execute(&state.pool)
        .await?;

        tracing::info!(
            username = %auth_user.username,
            jti = %claims.jti,
            "logout"
        );
    } else {
        tracing::info!(
            username = %auth_user.username,
            "logout (malformed refresh token — cookies cleared only)"
        );
    }

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/api/auth/me",
    responses((status = 200, description = "Current user", body = UserProfile)),
    security(("bearer_auth" = [])),
    tag = "auth"
)]
pub async fn me(auth_user: AuthUser) -> Json<UserProfile> {
    Json(UserProfile { username: auth_user.username })
}

async fn issue_pair(
    state: &AppState,
    username: &str,
    meta: &RequestMeta,
) -> Result<AuthResponse, AppError> {
    let access_ttl = state.config.access_token_ttl_secs;
    let refresh_ttl = state.config.refresh_token_ttl_secs;

    let (access_token, _) = jwt::issue_access(username, &state.config.jwt_secret, access_ttl)?;
    let (refresh_token, refresh_jti) =
        jwt::issue_refresh(username, &state.config.jwt_secret, refresh_ttl)?;
    let expires_at = Utc::now() + Duration::seconds(refresh_ttl as i64);

    sqlx::query(
        "INSERT INTO refresh_tokens (jti, username, expires_at, user_agent, ip) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(refresh_jti)
    .bind(username)
    .bind(expires_at)
    .bind(meta.user_agent.as_deref())
    .bind(meta.ip)
    .execute(&state.pool)
    .await?;

    Ok(AuthResponse {
        access_token,
        refresh_token,
        user: UserProfile { username: username.to_string() },
    })
}

#[derive(sqlx::FromRow)]
struct RefreshTokenRow {
    #[allow(dead_code)]
    jti: Uuid,
    username: String,
    expires_at: DateTime<Utc>,
    revoked_at: Option<DateTime<Utc>>,
}
