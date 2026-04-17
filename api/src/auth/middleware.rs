use axum::extract::{FromRef, FromRequestParts};
use axum::http::request::Parts;
use sqlx::PgPool;

use crate::auth::jwt;
use crate::config::Config;
use crate::error::{AppError, AuthErrorCode};

/// Extractor that validates the Bearer access token on the current request
/// and exposes the authenticated username. Unauthenticated requests return
/// a typed `token_missing` / `token_invalid` / `token_expired` error.
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub username: String,
}

impl<S> FromRequestParts<S> for AuthUser
where
    PgPool: FromRef<S>,
    Config: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let config = Config::from_ref(state);

        let header = parts
            .headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .ok_or(AppError::Auth(AuthErrorCode::TokenMissing))?;

        let token = header
            .strip_prefix("Bearer ")
            .ok_or(AppError::Auth(AuthErrorCode::TokenInvalid))?;

        let claims = jwt::decode_access(token, &config.jwt_secret)?;

        Ok(AuthUser { username: claims.sub })
    }
}
