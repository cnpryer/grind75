CREATE TABLE attempts (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug           TEXT NOT NULL,
    code           TEXT NOT NULL,
    passed         BOOLEAN NOT NULL,
    duration_ms    INTEGER NOT NULL,
    pytest_summary JSONB NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_attempts_slug_created ON attempts(slug, created_at DESC);
CREATE INDEX idx_attempts_passed ON attempts(passed);
