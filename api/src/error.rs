use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;

/// Typed auth error codes surfaced to the web layer so `hooks.server.ts`
/// can branch on them (refresh vs re-login vs rate-limit) without string-matching
/// free-text messages. See PLAN.md "Auth hardening — Error responses".
#[derive(Debug, Clone, Copy)]
pub enum AuthErrorCode {
    TokenExpired,
    TokenInvalid,
    TokenMissing,
    RefreshExpired,
    RefreshRevoked,
    RefreshInvalid,
    CredentialsInvalid,
    RateLimited,
}

impl AuthErrorCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::TokenExpired => "token_expired",
            Self::TokenInvalid => "token_invalid",
            Self::TokenMissing => "token_missing",
            Self::RefreshExpired => "refresh_expired",
            Self::RefreshRevoked => "refresh_revoked",
            Self::RefreshInvalid => "refresh_invalid",
            Self::CredentialsInvalid => "credentials_invalid",
            Self::RateLimited => "rate_limited",
        }
    }

    fn status(&self) -> StatusCode {
        match self {
            Self::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            _ => StatusCode::UNAUTHORIZED,
        }
    }

    fn default_message(&self) -> &'static str {
        match self {
            Self::TokenExpired => "Access token expired",
            Self::TokenInvalid => "Access token invalid",
            Self::TokenMissing => "Missing authentication",
            Self::RefreshExpired => "Refresh token expired",
            Self::RefreshRevoked => "Refresh token has been revoked",
            Self::RefreshInvalid => "Refresh token invalid",
            // Deliberately ambiguous — do not distinguish bad username vs bad password.
            Self::CredentialsInvalid => "Invalid username or password",
            Self::RateLimited => "Too many requests",
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Auth error: {0:?}")]
    Auth(AuthErrorCode),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Conflict: {0}")]
    Conflict(String),

    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

impl AppError {
    pub fn unauthorized() -> Self {
        Self::Auth(AuthErrorCode::TokenMissing)
    }
}

#[derive(Serialize)]
struct ErrorBody<'a> {
    error: &'a str,
    message: String,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message) = match &self {
            AppError::Auth(c) => (c.status(), c.as_str(), c.default_message().to_string()),
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, "not_found", msg.clone()),
            AppError::Validation(msg) => {
                (StatusCode::UNPROCESSABLE_ENTITY, "validation_error", msg.clone())
            }
            AppError::Conflict(msg) => (StatusCode::CONFLICT, "conflict", msg.clone()),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, "bad_request", msg.clone()),
            AppError::Internal(msg) => {
                tracing::error!("Internal error: {msg}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal_error",
                    "An internal error occurred".to_string(),
                )
            }
        };

        let body = ErrorBody { error: code, message };
        (status, axum::Json(body)).into_response()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        match err {
            sqlx::Error::RowNotFound => AppError::NotFound("Resource not found".to_string()),
            _ => AppError::Internal(err.to_string()),
        }
    }
}

impl From<jsonwebtoken::errors::Error> for AppError {
    fn from(err: jsonwebtoken::errors::Error) -> Self {
        use jsonwebtoken::errors::ErrorKind;
        match err.kind() {
            ErrorKind::ExpiredSignature => AppError::Auth(AuthErrorCode::TokenExpired),
            _ => AppError::Auth(AuthErrorCode::TokenInvalid),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn body_json(response: Response) -> serde_json::Value {
        let (_, body) = response.into_parts();
        let bytes = axum::body::to_bytes(body, usize::MAX).await.unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn auth_error_code_shape() {
        let response = AppError::Auth(AuthErrorCode::TokenExpired).into_response();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        let body = body_json(response).await;
        assert_eq!(body["error"], "token_expired");
        assert_eq!(body["message"], "Access token expired");
    }

    #[tokio::test]
    async fn rate_limited_is_429() {
        let response = AppError::Auth(AuthErrorCode::RateLimited).into_response();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
        let body = body_json(response).await;
        assert_eq!(body["error"], "rate_limited");
    }

    #[tokio::test]
    async fn credentials_invalid_message_is_ambiguous() {
        let response = AppError::Auth(AuthErrorCode::CredentialsInvalid).into_response();
        let body = body_json(response).await;
        assert_eq!(body["error"], "credentials_invalid");
        assert_eq!(body["message"], "Invalid username or password");
    }

    #[tokio::test]
    async fn internal_error_does_not_leak() {
        let response = AppError::Internal("secret leaked".to_string()).into_response();
        let body = body_json(response).await;
        assert_eq!(body["error"], "internal_error");
        assert_eq!(body["message"], "An internal error occurred");
        assert!(!serde_json::to_string(&body).unwrap().contains("secret"));
    }

    #[tokio::test]
    async fn expired_jwt_maps_to_token_expired() {
        let jwt_err = jsonwebtoken::errors::Error::from(
            jsonwebtoken::errors::ErrorKind::ExpiredSignature,
        );
        let app_err: AppError = jwt_err.into();
        let body = body_json(app_err.into_response()).await;
        assert_eq!(body["error"], "token_expired");
    }
}
