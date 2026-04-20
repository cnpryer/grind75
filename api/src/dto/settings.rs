use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Serialize, ToSchema, sqlx::FromRow)]
pub struct SettingsRecord {
    /// When true, the problem page starts the per-problem timer automatically
    /// on open instead of requiring the user to click Start.
    pub auto_start_timer: bool,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateSettingsRequest {
    pub auto_start_timer: Option<bool>,
}
