CREATE TABLE IF NOT EXISTS feedback (
    id SERIAL PRIMARY KEY,
    message_channel_id VARCHAR(255) NOT NULL,
    message_ts VARCHAR(255) NOT NULL,
    submitted_by_user_id VARCHAR(255) NOT NULL,
    reaction VARCHAR(50) NOT NULL,
    reasoning TEXT,
    submitted_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);