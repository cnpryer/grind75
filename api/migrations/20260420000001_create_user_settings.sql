-- Single-row table of app-level user preferences. This is a single-user app
-- (see auth — admin is the only principal), so we pin the row to id = 1 via
-- a CHECK constraint instead of carrying a user_id across the schema. The
-- seed INSERT guarantees the row is always present, so handlers don't need
-- lazy-insert logic.
CREATE TABLE user_settings (
    id               SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    auto_start_timer BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO user_settings (id) VALUES (1);
