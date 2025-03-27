import { config } from 'dotenv';
import { Client } from 'pg';

// Load environment variables
config();

async function setupTestDb(): Promise<void> {
  const client = new Client({
    connectionString: process.env.DB_URL,
  });

  try {
    await client.connect();
    console.log('Connected to test database');

    // Create the pgvector extension
    await client.query('CREATE EXTENSION IF NOT EXISTS vector;');
    console.log('pgvector extension created successfully');

    // Create the table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS rag_docs (
        source_type VARCHAR(255) NOT NULL,
        source_unique_id VARCHAR(255) NOT NULL UNIQUE PRIMARY KEY,
        content TEXT NOT NULL,
        embedding vector(1536),
        metadata JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS rag_docs_source_unique_id_idx ON rag_docs(source_unique_id);
      CREATE INDEX IF NOT EXISTS rag_docs_embedding_idx ON rag_docs USING ivfflat (embedding vector_cosine_ops);
      CREATE INDEX IF NOT EXISTS rag_docs_metadata_idx ON rag_docs USING GIN (metadata);
    `);
    console.log('Test database schema created successfully');
  } catch (error) {
    console.error('Error setting up test database:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

setupTestDb();
