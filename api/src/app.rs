use std::sync::Arc;

use axum::Router;
use axum::http::{HeaderValue, Method, header};
use axum::routing::{get, post};
use sqlx::PgPool;
use tower_governor::GovernorLayer;
use tower_governor::governor::GovernorConfigBuilder;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

use crate::config::Config;
use crate::routes;

/// OpenAPI doc. Routes are registered as they ship — content endpoints
/// (progress/attempts/problems) land in task #5.
#[derive(OpenApi)]
#[openapi(
    paths(
        routes::health::health_check,
        routes::auth::login,
        routes::auth::refresh,
        routes::auth::logout,
        routes::auth::me,
    ),
    components(schemas(
        routes::health::HealthResponse,
        crate::dto::auth::LoginRequest,
        crate::dto::auth::RefreshRequest,
        crate::dto::auth::LogoutRequest,
        crate::dto::auth::AuthResponse,
        crate::dto::auth::UserProfile,
    )),
    tags(
        (name = "health", description = "Health check"),
        (name = "auth", description = "Authentication"),
    ),
    modifiers(&SecurityAddon)
)]
pub struct ApiDoc;

struct SecurityAddon;

impl utoipa::Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        if let Some(components) = openapi.components.as_mut() {
            components.add_security_scheme(
                "bearer_auth",
                utoipa::openapi::security::SecurityScheme::Http(
                    utoipa::openapi::security::Http::new(
                        utoipa::openapi::security::HttpAuthScheme::Bearer,
                    ),
                ),
            );
        }
    }
}

pub fn create_router(pool: PgPool, config: Config) -> Router {
    let allowed_origin = config
        .web_url
        .parse::<HeaderValue>()
        .unwrap_or_else(|_| HeaderValue::from_static("http://localhost:5173"));

    let state = crate::AppState { pool, config };

    let cors = CorsLayer::new()
        .allow_origin(allowed_origin)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION]);

    // 5 attempts/min/IP on /api/auth/login — token-bucket refill 1 / 12s, burst 5.
    // tower_governor's default PeerIpKeyExtractor requires ConnectInfo, wired in main.rs.
    // The default error response is a plain 429 — we accept that for M0 (follow-up:
    // custom error handler that emits `{"error": "rate_limited", ...}`).
    let governor_conf = Arc::new(
        GovernorConfigBuilder::default()
            .per_second(12)
            .burst_size(5)
            .finish()
            .expect("governor config"),
    );

    let login_router = Router::new()
        .route("/api/auth/login", post(routes::auth::login))
        .layer(GovernorLayer { config: governor_conf });

    Router::new()
        .merge(login_router)
        .route("/api/health", get(routes::health::health_check))
        .route("/api/auth/refresh", post(routes::auth::refresh))
        .route("/api/auth/logout", post(routes::auth::logout))
        .route("/api/auth/me", get(routes::auth::me))
        .merge(SwaggerUi::new("/api/docs").url("/api/docs/openapi.json", ApiDoc::openapi()))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state)
}
