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
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AttemptRecord {
    pub id: Uuid,
    pub slug: String,
    pub code: String,
    pub passed: bool,
    pub duration_ms: i32,
    pub pytest_summary: serde_json::Value,
    pub created_at: chrono::DateTime<chrono::Utc>,
}
