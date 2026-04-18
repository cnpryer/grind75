//! M0 auth integration test: login → refresh rotation → replay → credentials_invalid.
//!
//! Runs against a real Postgres via `sqlx::test`, which spins up a per-test
//! database and applies `./migrations`. Run with `cargo test -p api`.
//! Requires `DATABASE_URL` pointing at a live Postgres (see `docker-compose.yml`).

use std::net::SocketAddr;
use std::time::Duration;

use api::{app, config::Config};
use reqwest::StatusCode;
use serde_json::json;
use sqlx::PgPool;
use tokio::net::TcpListener;

struct TestServer {
    base: String,
    _task: tokio::task::JoinHandle<()>,
}

async fn spawn(pool: PgPool) -> TestServer {
    let password_hash = api::auth::password::hash_password("dev").expect("hash");
    let config = Config {
        database_url: String::new(),
        jwt_secret: "test-secret-0123456789abcdef".to_string(),
        api_host: "127.0.0.1".to_string(),
        api_port: 0,
        origin: "http://localhost:5173".to_string(),
        admin_username: "admin".to_string(),
        admin_password_hash: password_hash,
        access_token_ttl_secs: 900,
        refresh_token_ttl_secs: 2_592_000,
    };
    let router = app::create_router(pool, config);

    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");
    let task = tokio::spawn(async move {
        axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .expect("serve");
    });

    TestServer {
        base: format!("http://{addr}"),
        _task: task,
    }
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .expect("client")
}

#[sqlx::test(migrations = "./migrations")]
async fn login_issues_tokens_and_me_resolves(pool: PgPool) {
    let server = spawn(pool).await;
    let client = client();

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
    let server = spawn(pool).await;
    let client = client();

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
    let server = spawn(pool).await;
    let client = client();

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
    let server = spawn(pool).await;
    let client = client();

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
    let server = spawn(pool).await;
    let client = client();

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
    let server = spawn(pool).await;
    let client = client();

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
    let server = spawn(pool).await;
    let client = client();

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
