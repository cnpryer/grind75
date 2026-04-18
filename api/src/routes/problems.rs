//! Stub for M0. M3 fills this in — returns the manifest built at web/build time;
//! the API-side version is optional (see PLAN.md "Problem data flow"). For now we
//! just mount the route so the layout is complete.

use axum::Json;
use serde::Serialize;
use utoipa::ToSchema;

#[derive(Serialize, ToSchema)]
pub struct ProblemSummary {
    pub slug: String,
    pub title: String,
    pub difficulty: String,
    pub pattern: String,
}

#[utoipa::path(
    get,
    path = "/api/problems",
    tag = "problems",
    responses((status = 200, body = [ProblemSummary]))
)]
pub async fn list() -> Json<Vec<ProblemSummary>> {
    Json(Vec::new())
}
