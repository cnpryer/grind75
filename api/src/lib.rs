pub mod app;
pub mod config;
pub mod db;
pub mod error;
pub mod routes;

use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub config: config::Config,
}

impl axum::extract::FromRef<AppState> for PgPool {
    fn from_ref(state: &AppState) -> Self {
        state.pool.clone()
    }
}

impl axum::extract::FromRef<AppState> for config::Config {
    fn from_ref(state: &AppState) -> Self {
        state.config.clone()
    }
}
