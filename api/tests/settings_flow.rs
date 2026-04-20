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
        web_url: "http://localhost:5173".to_string(),
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

async fn login_access_token(client: &reqwest::Client, base: &str) -> String {
    let login: serde_json::Value = client
        .post(format!("{base}/api/auth/login"))
        .json(&json!({"username": "admin", "password": "dev"}))
        .send()
        .await
        .expect("login")
        .json()
        .await
        .expect("login body");

    login["access_token"].as_str().expect("access").to_string()
}

#[sqlx::test(migrations = "./migrations")]
async fn get_settings_returns_migration_defaults(pool: PgPool) {
    let server = spawn(pool).await;
    let client = client();
    let access = login_access_token(&client, &server.base).await;

    let res = client
        .get(format!("{}/api/settings", server.base))
        .bearer_auth(&access)
        .send()
        .await
        .expect("get settings");
    assert_eq!(res.status(), StatusCode::OK);
    let body: serde_json::Value = res.json().await.expect("body");
    assert_eq!(body["auto_start_timer"], false);
    assert!(body["updated_at"].is_string());
}

#[sqlx::test(migrations = "./migrations")]
async fn put_settings_toggles_auto_start_timer(pool: PgPool) {
    let server = spawn(pool).await;
    let client = client();
    let access = login_access_token(&client, &server.base).await;

    let put = client
        .put(format!("{}/api/settings", server.base))
        .bearer_auth(&access)
        .json(&json!({"auto_start_timer": true}))
        .send()
        .await
        .expect("put");
    assert_eq!(put.status(), StatusCode::OK);
    let body: serde_json::Value = put.json().await.expect("put body");
    assert_eq!(body["auto_start_timer"], true);

    // Subsequent GET reflects the change.
    let get = client
        .get(format!("{}/api/settings", server.base))
        .bearer_auth(&access)
        .send()
        .await
        .expect("get");
    assert_eq!(get.status(), StatusCode::OK);
    let body: serde_json::Value = get.json().await.expect("get body");
    assert_eq!(body["auto_start_timer"], true);

    // Flipping back works too.
    let put = client
        .put(format!("{}/api/settings", server.base))
        .bearer_auth(&access)
        .json(&json!({"auto_start_timer": false}))
        .send()
        .await
        .expect("put again");
    assert_eq!(put.status(), StatusCode::OK);
    let body: serde_json::Value = put.json().await.expect("put again body");
    assert_eq!(body["auto_start_timer"], false);
}

#[sqlx::test(migrations = "./migrations")]
async fn put_settings_rejects_empty_body(pool: PgPool) {
    let server = spawn(pool).await;
    let client = client();
    let access = login_access_token(&client, &server.base).await;

    let res = client
        .put(format!("{}/api/settings", server.base))
        .bearer_auth(&access)
        .json(&json!({}))
        .send()
        .await
        .expect("put");
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    let body: serde_json::Value = res.json().await.expect("body");
    assert_eq!(body["error"], "bad_request");
}

#[sqlx::test(migrations = "./migrations")]
async fn settings_endpoints_require_auth(pool: PgPool) {
    let server = spawn(pool).await;
    let client = client();

    let get = client
        .get(format!("{}/api/settings", server.base))
        .send()
        .await
        .expect("get");
    assert_eq!(get.status(), StatusCode::UNAUTHORIZED);

    let put = client
        .put(format!("{}/api/settings", server.base))
        .json(&json!({"auto_start_timer": true}))
        .send()
        .await
        .expect("put");
    assert_eq!(put.status(), StatusCode::UNAUTHORIZED);
}
