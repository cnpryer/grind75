CREATE TABLE refresh_tokens (
    jti          UUID PRIMARY KEY,
    username     TEXT NOT NULL,
    issued_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ NOT NULL,
    revoked_at   TIMESTAMPTZ,
    replaced_by  UUID REFERENCES refresh_tokens(jti),
    user_agent   TEXT,
    ip           INET
);

CREATE INDEX idx_refresh_tokens_active ON refresh_tokens(expires_at) WHERE revoked_at IS NULL;
CREATE INDEX idx_refresh_tokens_username ON refresh_tokens(username);
