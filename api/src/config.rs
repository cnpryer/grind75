use std::env;

#[derive(Clone)]
pub struct Config {
    pub database_url: String,
    pub jwt_secret: String,
    pub api_host: String,
    pub api_port: u16,
    pub web_url: String,
    pub admin_username: String,
    pub admin_password_hash: String,
    pub access_token_ttl_secs: u64,
    pub refresh_token_ttl_secs: u64,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            database_url: env::var("DATABASE_URL").expect("DATABASE_URL must be set"),
            jwt_secret: env::var("JWT_SECRET").expect("JWT_SECRET must be set"),
            api_host: env::var("API_HOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
            api_port: env::var("API_PORT")
                .unwrap_or_else(|_| "3001".to_string())
                .parse()
                .expect("API_PORT must be a valid port number"),
            web_url: env::var("WEB_URL").unwrap_or_else(|_| "http://localhost:5173".to_string()),
            admin_username: env::var("ADMIN_USERNAME").expect("ADMIN_USERNAME must be set"),
            admin_password_hash: env::var("ADMIN_PASSWORD_HASH")
                .expect("ADMIN_PASSWORD_HASH must be set"),
            access_token_ttl_secs: env::var("ACCESS_TOKEN_TTL_SECS")
                .unwrap_or_else(|_| "900".to_string())
                .parse()
                .expect("ACCESS_TOKEN_TTL_SECS must be a non-negative integer"),
            refresh_token_ttl_secs: env::var("REFRESH_TOKEN_TTL_SECS")
                .unwrap_or_else(|_| "2592000".to_string())
                .parse()
                .expect("REFRESH_TOKEN_TTL_SECS must be a non-negative integer"),
        }
    }
}
