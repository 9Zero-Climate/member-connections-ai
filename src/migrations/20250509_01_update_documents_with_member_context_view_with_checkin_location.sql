-- Migration to create or replace the view for enriching RAG documents with member context
-- Update the view with member.checkin_location_today (and remove old location_tags column)
-- Drop the old view if it exists (optional, but safer)
DROP VIEW IF EXISTS documents_with_member_context;
-- Create or replace the new view
CREATE OR REPLACE VIEW documents_with_member_context AS
SELECT rd.created_at,
    rd.source_type,
    rd.source_unique_id,
    rd.content,
    rd.embedding,
    rd.updated_at,
    rd.metadata,
    m.name AS member_name,
    COALESCE(
        m.slack_id,
        rd.metadata->>'slack_user_id'::text
    ) AS member_slack_id,
    m.location as member_location,
    m.checkin_location_today as member_checkin_location_today,
    m.linkedin_url as member_linkedin_url,
    m.notion_page_id as member_notion_page_id,
    m.notion_page_url as member_notion_page_url,
    m.officernd_id as member_officernd_id
FROM rag_docs rd
    LEFT JOIN members m ON (
        m.linkedin_url = (rd.metadata->>'linkedin_url'::text)
        OR m.slack_id = (rd.metadata->>'slack_user_id'::text)
        OR m.slack_id = (rd.metadata->>'user'::text) -- alternative place we sometimes store slack ID
        OR m.officernd_id = (rd.metadata->>'officernd_member_id'::text)
    );