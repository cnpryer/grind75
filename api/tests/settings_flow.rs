mod common;

use reqwest::StatusCode;
use serde_json::json;
use sqlx::PgPool;

#[sqlx::test(migrations = "./migrations")]
async fn get_settings_returns_migration_defaults(pool: PgPool) {
    let server = common::spawn(pool).await;
    let client = common::client();
    let access = common::login_access_token(&client, &server.base).await;

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
    let server = common::spawn(pool).await;
    let client = common::client();
    let access = common::login_access_token(&client, &server.base).await;

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
    let server = common::spawn(pool).await;
    let client = common::client();
    let access = common::login_access_token(&client, &server.base).await;

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
    let server = common::spawn(pool).await;
    let client = common::client();

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
