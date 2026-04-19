CREATE INDEX idx_attempts_created_at ON attempts USING brin(created_at);
