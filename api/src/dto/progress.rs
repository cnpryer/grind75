use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Serialize, Deserialize, ToSchema, Clone, Copy, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "progress_status", rename_all = "snake_case")]
pub enum ProgressStatus {
    NotStarted,
    Attempted,
    Solved,
}

#[derive(Debug, Serialize, ToSchema, sqlx::FromRow)]
pub struct ProgressRecord {
    pub slug: String,
    pub status: ProgressStatus,
    pub last_code: Option<String>,
    pub notes: Option<String>,
    pub attempt_count: i32,
    pub solved_at: Option<chrono::DateTime<chrono::Utc>>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpsertProgressRequest {
    pub status: Option<ProgressStatus>,
    pub last_code: Option<String>,
    pub notes: Option<String>,
}
