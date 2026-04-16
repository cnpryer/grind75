use std::net::SocketAddr;
use tokio::net::TcpListener;

use api::{app, config::Config, db};

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,api=debug".into()),
        )
        .init();

    let config = Config::from_env();
    let pool = db::create_pool(&config.database_url).await;

    tracing::info!("Running database migrations...");
    db::run_migrations(&pool).await;

    let addr: SocketAddr = format!("{}:{}", config.api_host, config.api_port)
        .parse()
        .expect("Invalid address");

    let router = app::create_router(pool, config);

    tracing::info!("grind75 API listening on {addr}");
    tracing::info!("Swagger UI at http://{addr}/api/docs/");

    let listener = TcpListener::bind(addr).await.expect("Failed to bind");
    axum::serve(listener, router).await.expect("Server error");
}
