use std::net::SocketAddr;
use std::time::Duration;

use api::{app, config::Config};
use serde_json::json;
use sqlx::PgPool;
use tokio::net::TcpListener;

pub struct TestServer {
    pub base: String,
    pub _task: tokio::task::JoinHandle<()>,
}

pub async fn spawn(pool: PgPool) -> TestServer {
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

pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .expect("client")
}

pub async fn login_access_token(client: &reqwest::Client, base: &str) -> String {
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
