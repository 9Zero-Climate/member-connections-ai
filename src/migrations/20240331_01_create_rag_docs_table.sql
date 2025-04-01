-- Create rag_docs table
CREATE TABLE IF NOT EXISTS rag_docs (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    embedding vector(1536),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
-- Create index on metadata for faster lookups
CREATE INDEX IF NOT EXISTS idx_rag_docs_metadata ON rag_docs USING GIN (metadata);