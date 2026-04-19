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
async fn submit_attempt_updates_progress(pool: PgPool) {
    let server = spawn(pool).await;
    let client = client();
    let access = login_access_token(&client, &server.base).await;

    let first = client
        .post(format!("{}/api/attempts", server.base))
        .bearer_auth(&access)
        .json(&json!({
            "slug": "two-sum",
            "code": "def two_sum(nums, target): return []",
            "passed": false,
            "duration_ms": 10,
            "pytest_summary": {"passed": 0, "failed": 1, "errored": 0, "total": 1, "tests": []}
        }))
        .send()
        .await
        .expect("attempt 1");
    assert_eq!(first.status(), StatusCode::CREATED);

    let second = client
        .post(format!("{}/api/attempts", server.base))
        .bearer_auth(&access)
        .json(&json!({
            "slug": "two-sum",
            "code": "def two_sum(nums, target): return [0, 1]",
            "passed": true,
            "duration_ms": 9,
            "pytest_summary": {"passed": 1, "failed": 0, "errored": 0, "total": 1, "tests": []}
        }))
        .send()
        .await
        .expect("attempt 2");
    assert_eq!(second.status(), StatusCode::CREATED);

    let progress = client
        .get(format!("{}/api/progress/two-sum", server.base))
        .bearer_auth(&access)
        .send()
        .await
        .expect("progress");
    assert_eq!(progress.status(), StatusCode::OK);
    let body: serde_json::Value = progress.json().await.expect("progress body");
    assert_eq!(body["status"], "solved");
    assert_eq!(body["attempt_count"], 2);
    assert_eq!(
        body["last_code"],
        "def two_sum(nums, target): return [0, 1]"
    );
    assert!(body["solved_at"].is_string());
}

#[sqlx::test(migrations = "./migrations")]
async fn heatmap_aggregates_attempts_by_day(pool: PgPool) {
    let server = spawn(pool).await;
    let client = client();
    let access = login_access_token(&client, &server.base).await;

    for _ in 0..3 {
        let res = client
            .post(format!("{}/api/attempts", server.base))
            .bearer_auth(&access)
            .json(&json!({
                "slug": "two-sum",
                "code": "def two_sum(nums, target): return [0, 1]",
                "passed": true,
                "duration_ms": 12,
                "pytest_summary": {"passed": 1, "failed": 0, "errored": 0, "total": 1, "tests": []}
            }))
            .send()
            .await
            .expect("attempt");
        assert_eq!(res.status(), StatusCode::CREATED);
    }

    let heatmap = client
        .get(format!("{}/api/attempts/heatmap", server.base))
        .bearer_auth(&access)
        .send()
        .await
        .expect("heatmap");
    assert_eq!(heatmap.status(), StatusCode::OK);

    let cells: Vec<serde_json::Value> = heatmap.json().await.expect("heatmap body");
    assert_eq!(
        cells.len(),
        1,
        "heatmap should contain a single aggregated cell for today's attempts"
    );
    assert_eq!(cells[0]["count"].as_i64().expect("count"), 3);
    assert!(cells[0]["date"].is_string(), "date should be an ISO string");
}

#[sqlx::test(migrations = "./migrations")]
async fn unsolve_flips_solved_back_to_attempted(pool: PgPool) {
    let server = spawn(pool).await;
    let client = client();
    let access = login_access_token(&client, &server.base).await;

    let submit = client
        .post(format!("{}/api/attempts", server.base))
        .bearer_auth(&access)
        .json(&json!({
            "slug": "two-sum",
            "code": "def two_sum(nums, target): return [0, 1]",
            "passed": true,
            "duration_ms": 9,
            "elapsed_ms": 60_000,
            "pytest_summary": {"passed": 1, "failed": 0, "errored": 0, "total": 1, "tests": []}
        }))
        .send()
        .await
        .expect("submit");
    assert_eq!(submit.status(), StatusCode::CREATED);

    let unsolve = client
        .post(format!("{}/api/progress/two-sum/unsolve", server.base))
        .bearer_auth(&access)
        .send()
        .await
        .expect("unsolve");
    assert_eq!(unsolve.status(), StatusCode::OK);
    let body: serde_json::Value = unsolve.json().await.expect("unsolve body");
    assert_eq!(body["status"], "attempted");
    assert!(body["solved_at"].is_null());
    assert_eq!(body["attempt_count"], 1);

    let missing = client
        .post(format!(
            "{}/api/progress/never-touched/unsolve",
            server.base
        ))
        .bearer_auth(&access)
        .send()
        .await
        .expect("unsolve missing");
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
}

#[sqlx::test(migrations = "./migrations")]
async fn upsert_progress_roundtrip(pool: PgPool) {
    let server = spawn(pool).await;
    let client = client();
    let access = login_access_token(&client, &server.base).await;

    let upsert = client
        .put(format!("{}/api/progress/two-sum", server.base))
        .bearer_auth(&access)
        .json(&json!({
            "status": "attempted",
            "last_code": "def two_sum(nums, target): return []",
            "notes": "Need hashmap to avoid O(n^2)."
        }))
        .send()
        .await
        .expect("upsert");
    assert_eq!(upsert.status(), StatusCode::OK);

    let fetch = client
        .get(format!("{}/api/progress/two-sum", server.base))
        .bearer_auth(&access)
        .send()
        .await
        .expect("fetch");
    assert_eq!(fetch.status(), StatusCode::OK);

    let body: serde_json::Value = fetch.json().await.expect("fetch body");
    assert_eq!(body["status"], "attempted");
    assert_eq!(body["notes"], "Need hashmap to avoid O(n^2).");
    assert_eq!(body["last_code"], "def two_sum(nums, target): return []");
    assert_eq!(body["attempt_count"], 0);
}
