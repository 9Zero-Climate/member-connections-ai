CREATE TABLE IF NOT EXISTS feedback (
    id SERIAL PRIMARY KEY,
    message_channel_id TEXT NOT NULL,
    message_ts TEXT NOT NULL,
    submitted_by_user_id TEXT NOT NULL,
    reaction TEXT NOT NULL,
    reasoning TEXT,
    submitted_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);