-- Create members table
CREATE TABLE IF NOT EXISTS members (
    officernd_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slack_id TEXT,
    linkedin_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
-- Create index on slack_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_members_slack_id ON members(slack_id);
-- Create index on linkedin_url for faster lookups
CREATE INDEX IF NOT EXISTS idx_members_linkedin_url ON members(linkedin_url);
-- Create view for documents with member info
CREATE OR REPLACE VIEW documents_with_slack_user_id AS
SELECT rd.*,
    COALESCE(m.slack_id, rd.metadata->>'slack_user_id') as slack_user_id
FROM rag_docs rd
    LEFT JOIN members m ON m.linkedin_url = rd.metadata->>'linkedin_url';