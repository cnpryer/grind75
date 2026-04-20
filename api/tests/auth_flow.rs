//! M0 auth integration test: login → refresh rotation → replay → credentials_invalid.
//!
//! Runs against a real Postgres via `sqlx::test`, which spins up a per-test
//! database and applies `./migrations`. Run with `cargo test -p api`.
//! Requires `DATABASE_URL` pointing at a live Postgres (see `docker-compose.yml`).

mod common;

use reqwest::StatusCode;
use serde_json::json;
use sqlx::PgPool;

#[sqlx::test(migrations = "./migrations")]
async fn login_issues_tokens_and_me_resolves(pool: PgPool) {
    let server = common::spawn(pool).await;
    let client = common::client();

    let login = client
        .post(format!("{}/api/auth/login", server.base))
        .json(&json!({"username": "admin", "password": "dev"}))
        .send()
        .await
        .expect("login send");
    assert_eq!(login.status(), StatusCode::OK);
    let body: serde_json::Value = login.json().await.expect("login body");
    let access = body["access_token"]
        .as_str()
        .expect("access_token")
        .to_string();
    assert!(body["refresh_token"].as_str().is_some());
    assert_eq!(body["user"]["username"], "admin");

    let me = client
        .get(format!("{}/api/auth/me", server.base))
        .bearer_auth(&access)
        .send()
        .await
        .expect("me send");
    assert_eq!(me.status(), StatusCode::OK);
    let me_body: serde_json::Value = me.json().await.expect("me body");
    assert_eq!(me_body["username"], "admin");
}

#[sqlx::test(migrations = "./migrations")]
async fn me_without_token_is_token_missing(pool: PgPool) {
    let server = common::spawn(pool).await;
    let client = common::client();

    let res = client
        .get(format!("{}/api/auth/me", server.base))
        .send()
        .await
        .expect("send");
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    let body: serde_json::Value = res.json().await.expect("body");
    assert_eq!(body["error"], "token_missing");
}

#[sqlx::test(migrations = "./migrations")]
async fn bad_password_is_credentials_invalid(pool: PgPool) {
    let server = common::spawn(pool).await;
    let client = common::client();

    let res = client
        .post(format!("{}/api/auth/login", server.base))
        .json(&json!({"username": "admin", "password": "nope"}))
        .send()
        .await
        .expect("send");
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    let body: serde_json::Value = res.json().await.expect("body");
    assert_eq!(body["error"], "credentials_invalid");
    // Message is deliberately ambiguous between bad username and bad password.
    assert_eq!(body["message"], "Invalid username or password");
}

#[sqlx::test(migrations = "./migrations")]
async fn unknown_user_is_credentials_invalid(pool: PgPool) {
    let server = common::spawn(pool).await;
    let client = common::client();

    let res = client
        .post(format!("{}/api/auth/login", server.base))
        .json(&json!({"username": "ghost", "password": "dev"}))
        .send()
        .await
        .expect("send");
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    let body: serde_json::Value = res.json().await.expect("body");
    assert_eq!(body["error"], "credentials_invalid");
}

#[sqlx::test(migrations = "./migrations")]
async fn refresh_rotates_and_replay_revokes(pool: PgPool) {
    let server = common::spawn(pool).await;
    let client = common::client();

    // 1. Login.
    let login: serde_json::Value = client
        .post(format!("{}/api/auth/login", server.base))
        .json(&json!({"username": "admin", "password": "dev"}))
        .send()
        .await
        .expect("login")
        .json()
        .await
        .expect("login body");
    let original_refresh = login["refresh_token"].as_str().unwrap().to_string();

    // 2. Use the refresh token — get a fresh pair.
    let rotated: serde_json::Value = client
        .post(format!("{}/api/auth/refresh", server.base))
        .json(&json!({"refresh_token": &original_refresh}))
        .send()
        .await
        .expect("refresh")
        .json()
        .await
        .expect("refresh body");
    let rotated_access = rotated["access_token"].as_str().unwrap().to_string();
    let rotated_refresh = rotated["refresh_token"].as_str().unwrap().to_string();
    assert_ne!(rotated_refresh, original_refresh);

    // 3. The rotated access token should still authenticate /me.
    let me = client
        .get(format!("{}/api/auth/me", server.base))
        .bearer_auth(&rotated_access)
        .send()
        .await
        .expect("me");
    assert_eq!(me.status(), StatusCode::OK);

    // 4. Replay the original (now revoked) refresh token → 401 refresh_revoked.
    let replay = client
        .post(format!("{}/api/auth/refresh", server.base))
        .json(&json!({"refresh_token": original_refresh}))
        .send()
        .await
        .expect("replay");
    assert_eq!(replay.status(), StatusCode::UNAUTHORIZED);
    let replay_body: serde_json::Value = replay.json().await.expect("replay body");
    assert_eq!(replay_body["error"], "refresh_revoked");

    // 5. Theft signal: the rotated (previously valid) refresh token should also be dead now.
    let chain_kill = client
        .post(format!("{}/api/auth/refresh", server.base))
        .json(&json!({"refresh_token": rotated_refresh}))
        .send()
        .await
        .expect("chain kill");
    assert_eq!(chain_kill.status(), StatusCode::UNAUTHORIZED);
    let chain_body: serde_json::Value = chain_kill.json().await.expect("chain body");
    assert_eq!(chain_body["error"], "refresh_revoked");
}

#[sqlx::test(migrations = "./migrations")]
async fn logout_revokes_refresh_token(pool: PgPool) {
    let server = common::spawn(pool).await;
    let client = common::client();

    let login: serde_json::Value = client
        .post(format!("{}/api/auth/login", server.base))
        .json(&json!({"username": "admin", "password": "dev"}))
        .send()
        .await
        .expect("login")
        .json()
        .await
        .expect("login body");
    let access = login["access_token"].as_str().unwrap().to_string();
    let refresh = login["refresh_token"].as_str().unwrap().to_string();

    let logout = client
        .post(format!("{}/api/auth/logout", server.base))
        .bearer_auth(&access)
        .json(&json!({"refresh_token": &refresh}))
        .send()
        .await
        .expect("logout");
    assert_eq!(logout.status(), StatusCode::NO_CONTENT);

    let replay = client
        .post(format!("{}/api/auth/refresh", server.base))
        .json(&json!({"refresh_token": refresh}))
        .send()
        .await
        .expect("replay");
    assert_eq!(replay.status(), StatusCode::UNAUTHORIZED);
    let body: serde_json::Value = replay.json().await.expect("body");
    assert_eq!(body["error"], "refresh_revoked");
}

#[sqlx::test(migrations = "./migrations")]
async fn garbage_token_is_token_invalid(pool: PgPool) {
    let server = common::spawn(pool).await;
    let client = common::client();

    let res = client
        .get(format!("{}/api/auth/me", server.base))
        .bearer_auth("not.a.jwt")
        .send()
        .await
        .expect("send");
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    let body: serde_json::Value = res.json().await.expect("body");
    assert_eq!(body["error"], "token_invalid");
}
