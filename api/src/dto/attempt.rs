use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateAttemptRequest {
    pub slug: String,
    pub code: String,
    pub passed: bool,
    pub duration_ms: i32,
    pub pytest_summary: serde_json::Value,
    /// Wall-clock time the user spent before submitting (from the per-problem timer).
    /// Optional so pre-M9 clients still work.
    #[serde(default)]
    pub elapsed_ms: i32,
}

#[derive(Debug, Serialize, ToSchema, sqlx::FromRow)]
pub struct AttemptRecord {
    pub id: Uuid,
    pub slug: String,
    pub code: String,
    pub passed: bool,
    pub duration_ms: i32,
    pub elapsed_ms: i32,
    pub pytest_summary: serde_json::Value,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct HeatmapCell {
    pub date: chrono::NaiveDate,
    pub count: i64,
}
