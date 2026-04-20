mod common;

use reqwest::StatusCode;
use serde_json::json;
use sqlx::PgPool;

#[sqlx::test(migrations = "./migrations")]
async fn submit_attempt_updates_progress(pool: PgPool) {
    let server = common::spawn(pool).await;
    let client = common::client();
    let access = common::login_access_token(&client, &server.base).await;

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
    assert_eq!(
        body["total_elapsed_ms"].as_i64().expect("total_elapsed_ms"),
        0,
        "no elapsed_ms sent in legacy-shaped payloads; aggregate should be 0"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn progress_aggregates_total_elapsed_ms(pool: PgPool) {
    let server = common::spawn(pool).await;
    let client = common::client();
    let access = common::login_access_token(&client, &server.base).await;

    for elapsed in [12_345i64, 6_789i64, 1_000i64] {
        let res = client
            .post(format!("{}/api/attempts", server.base))
            .bearer_auth(&access)
            .json(&json!({
                "slug": "two-sum",
                "code": "def two_sum(nums, target): return [0, 1]",
                "passed": true,
                "duration_ms": 10,
                "elapsed_ms": elapsed,
                "pytest_summary": {"passed": 1, "failed": 0, "errored": 0, "total": 1, "tests": []}
            }))
            .send()
            .await
            .expect("attempt");
        assert_eq!(res.status(), StatusCode::CREATED);
    }

    let progress = client
        .get(format!("{}/api/progress/two-sum", server.base))
        .bearer_auth(&access)
        .send()
        .await
        .expect("progress");
    assert_eq!(progress.status(), StatusCode::OK);
    let body: serde_json::Value = progress.json().await.expect("progress body");
    assert_eq!(
        body["total_elapsed_ms"].as_i64().expect("total_elapsed_ms"),
        12_345 + 6_789 + 1_000
    );

    // Also confirm /api/progress list returns the same aggregate.
    let list: serde_json::Value = client
        .get(format!("{}/api/progress", server.base))
        .bearer_auth(&access)
        .send()
        .await
        .expect("list")
        .json()
        .await
        .expect("list body");
    let entry = list
        .as_array()
        .expect("list array")
        .iter()
        .find(|r| r["slug"] == "two-sum")
        .expect("two-sum row");
    assert_eq!(
        entry["total_elapsed_ms"]
            .as_i64()
            .expect("total_elapsed_ms"),
        12_345 + 6_789 + 1_000
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn heatmap_aggregates_attempts_by_day(pool: PgPool) {
    let server = common::spawn(pool).await;
    let client = common::client();
    let access = common::login_access_token(&client, &server.base).await;

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
    let server = common::spawn(pool).await;
    let client = common::client();
    let access = common::login_access_token(&client, &server.base).await;

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
async fn unsolve_is_noop_for_non_solved(pool: PgPool) {
    let server = common::spawn(pool).await;
    let client = common::client();
    let access = common::login_access_token(&client, &server.base).await;

    client
        .put(format!("{}/api/progress/two-sum", server.base))
        .bearer_auth(&access)
        .json(&json!({"status": "attempted"}))
        .send()
        .await
        .expect("seed");

    let before: serde_json::Value = client
        .get(format!("{}/api/progress/two-sum", server.base))
        .bearer_auth(&access)
        .send()
        .await
        .expect("fetch before")
        .json()
        .await
        .expect("before body");
    let updated_before = before["updated_at"]
        .as_str()
        .expect("updated_at")
        .to_string();

    let res = client
        .post(format!("{}/api/progress/two-sum/unsolve", server.base))
        .bearer_auth(&access)
        .send()
        .await
        .expect("unsolve");
    assert_eq!(res.status(), StatusCode::OK);
    let body: serde_json::Value = res.json().await.expect("unsolve body");
    assert_eq!(body["status"], "attempted");
    assert_eq!(
        body["updated_at"].as_str().expect("updated_at"),
        updated_before,
        "unsolve must not touch updated_at for non-solved rows"
    );
}

#[sqlx::test(migrations = "./migrations")]
async fn upsert_progress_roundtrip(pool: PgPool) {
    let server = common::spawn(pool).await;
    let client = common::client();
    let access = common::login_access_token(&client, &server.base).await;

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
