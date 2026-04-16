/**
 * PM2 Ecosystem Configuration for grind75.
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 restart grind75-web grind75-api
 *   pm2 logs
 */

const fs = require('node:fs');
const path = require('node:path');
const envFile = path.join(__dirname, '.env.production');
if (fs.existsSync(envFile)) {
  const lines = fs.readFileSync(envFile, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        process.env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
      }
    }
  }
}

module.exports = {
  apps: [
    {
      name: 'grind75-web',
      cwd: './web',
      script: './build/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '0.0.0.0',
        API_URL: process.env.API_URL || 'http://127.0.0.1:3001',
        ORIGIN: process.env.ORIGIN || 'http://localhost:3000',
      },
      error_file: './logs/web-err.log',
      out_file: './logs/web-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
    {
      name: 'grind75-api',
      cwd: './api',
      script: './target/release/api',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        API_HOST: '127.0.0.1',
        API_PORT: 3001,
        RUST_LOG: process.env.RUST_LOG || 'info',
        DATABASE_URL: process.env.DATABASE_URL || '',
        JWT_SECRET: process.env.JWT_SECRET || '',
        ADMIN_USERNAME: process.env.ADMIN_USERNAME || '',
        ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH || '',
        ACCESS_TOKEN_TTL_SECS: process.env.ACCESS_TOKEN_TTL_SECS || '900',
        REFRESH_TOKEN_TTL_SECS: process.env.REFRESH_TOKEN_TTL_SECS || '2592000',
      },
      error_file: './logs/api-err.log',
      out_file: './logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
