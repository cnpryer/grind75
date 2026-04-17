use chrono::Utc;
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AuthErrorCode};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TokenKind {
    Access,
    Refresh,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub jti: Uuid,
    pub typ: TokenKind,
    pub exp: i64,
    pub iat: i64,
}

/// Issue an access token for `username` with a fresh `jti` and the configured TTL.
/// The jti isn't tracked server-side for access tokens — the ≤15 min expiry is the sole guard.
pub fn issue_access(
    username: &str,
    secret: &str,
    ttl_secs: u64,
) -> Result<(String, Uuid), AppError> {
    issue(username, secret, ttl_secs, TokenKind::Access)
}

/// Issue a refresh token. The caller is responsible for persisting its `jti`
/// into the `refresh_tokens` table (handled in the login/refresh handlers).
pub fn issue_refresh(
    username: &str,
    secret: &str,
    ttl_secs: u64,
) -> Result<(String, Uuid), AppError> {
    issue(username, secret, ttl_secs, TokenKind::Refresh)
}

fn issue(
    username: &str,
    secret: &str,
    ttl_secs: u64,
    typ: TokenKind,
) -> Result<(String, Uuid), AppError> {
    let jti = Uuid::new_v4();
    let now = Utc::now().timestamp();
    let claims = Claims {
        sub: username.to_string(),
        jti,
        typ,
        exp: now + ttl_secs as i64,
        iat: now,
    };

    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(format!("Token signing failed: {e}")))?;

    Ok((token, jti))
}

/// Decode and validate an access token. Returns claims only if the token's
/// `typ` is `Access`; a refresh token presented as an access token returns `TokenInvalid`.
pub fn decode_access(token: &str, secret: &str) -> Result<Claims, AppError> {
    decode_as(token, secret, TokenKind::Access)
}

/// Decode and validate a refresh token. Maps expiry → `RefreshExpired` (distinct
/// from `TokenExpired`) so the web can branch correctly.
pub fn decode_refresh(token: &str, secret: &str) -> Result<Claims, AppError> {
    use jsonwebtoken::errors::ErrorKind;
    let claims = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|e| match e.kind() {
        ErrorKind::ExpiredSignature => AppError::Auth(AuthErrorCode::RefreshExpired),
        _ => AppError::Auth(AuthErrorCode::RefreshInvalid),
    })?
    .claims;

    if claims.typ != TokenKind::Refresh {
        return Err(AppError::Auth(AuthErrorCode::RefreshInvalid));
    }

    Ok(claims)
}

fn decode_as(token: &str, secret: &str, expected: TokenKind) -> Result<Claims, AppError> {
    let claims = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )?
    .claims;

    if claims.typ != expected {
        return Err(AppError::Auth(AuthErrorCode::TokenInvalid));
    }

    Ok(claims)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn access_token_roundtrip() {
        let (token, jti) = issue_access("me", "secret", 60).unwrap();
        let claims = decode_access(&token, "secret").unwrap();
        assert_eq!(claims.sub, "me");
        assert_eq!(claims.jti, jti);
        assert_eq!(claims.typ, TokenKind::Access);
    }

    #[test]
    fn refresh_cannot_be_used_as_access() {
        let (refresh, _) = issue_refresh("me", "secret", 60).unwrap();
        let err = decode_access(&refresh, "secret").unwrap_err();
        match err {
            AppError::Auth(AuthErrorCode::TokenInvalid) => {}
            other => panic!("expected TokenInvalid, got {other:?}"),
        }
    }

    #[test]
    fn access_cannot_be_used_as_refresh() {
        let (access, _) = issue_access("me", "secret", 60).unwrap();
        let err = decode_refresh(&access, "secret").unwrap_err();
        match err {
            AppError::Auth(AuthErrorCode::RefreshInvalid) => {}
            other => panic!("expected RefreshInvalid, got {other:?}"),
        }
    }

    #[test]
    fn wrong_secret_is_token_invalid() {
        let (token, _) = issue_access("me", "secret", 60).unwrap();
        match decode_access(&token, "different").unwrap_err() {
            AppError::Auth(AuthErrorCode::TokenInvalid) => {}
            other => panic!("expected TokenInvalid, got {other:?}"),
        }
    }

    #[test]
    fn expired_access_token_is_token_expired() {
        // TTL=0 is past-expiry once jwt validates with default leeway=0.
        // Actually default validation allows some leeway; force negative.
        // Use a token that's already expired.
        let now = Utc::now().timestamp();
        let claims = Claims {
            sub: "me".to_string(),
            jti: Uuid::new_v4(),
            typ: TokenKind::Access,
            exp: now - 60,
            iat: now - 120,
        };
        let token = encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(b"secret"),
        )
        .unwrap();
        match decode_access(&token, "secret").unwrap_err() {
            AppError::Auth(AuthErrorCode::TokenExpired) => {}
            other => panic!("expected TokenExpired, got {other:?}"),
        }
    }

    #[test]
    fn expired_refresh_token_is_refresh_expired() {
        let now = Utc::now().timestamp();
        let claims = Claims {
            sub: "me".to_string(),
            jti: Uuid::new_v4(),
            typ: TokenKind::Refresh,
            exp: now - 60,
            iat: now - 120,
        };
        let token = encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(b"secret"),
        )
        .unwrap();
        match decode_refresh(&token, "secret").unwrap_err() {
            AppError::Auth(AuthErrorCode::RefreshExpired) => {}
            other => panic!("expected RefreshExpired, got {other:?}"),
        }
    }
}
