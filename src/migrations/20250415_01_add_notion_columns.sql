-- Add notion_page_id column with a unique constraint
ALTER TABLE members
ADD COLUMN notion_page_id TEXT NULL;
ALTER TABLE members
ADD CONSTRAINT unique_notion_page_id UNIQUE (notion_page_id);
ALTER TABLE members
ADD COLUMN notion_page_url TEXT NULL;
ALTER TABLE members
ADD COLUMN location_tags TEXT [] NULL;