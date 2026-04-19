-- Wall-clock time the user spent on this attempt, tracked via the per-problem
-- timer. Distinct from `duration_ms`, which measures the Pyodide test run.
ALTER TABLE attempts
    ADD COLUMN elapsed_ms INTEGER NOT NULL DEFAULT 0;
