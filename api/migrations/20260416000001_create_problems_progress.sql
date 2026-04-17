CREATE TYPE progress_status AS ENUM ('not_started', 'attempted', 'solved');

CREATE TABLE problems_progress (
    slug          TEXT PRIMARY KEY,
    status        progress_status NOT NULL DEFAULT 'not_started',
    last_code     TEXT,
    notes         TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    solved_at     TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_problems_progress_status ON problems_progress(status);
