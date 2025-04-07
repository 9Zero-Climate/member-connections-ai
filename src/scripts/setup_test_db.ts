import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { config } from '../config'; // Import unified config
import { logger } from '../services/logger';

async function setupTestDb(): Promise<void> {
  const client = new Client({
    connectionString: config.dbUrl, // Use config
  });

  try {
    await client.connect();
    logger.info('Connected to database for test setup.');

    // Drop existing table if it exists
    logger.info('Dropping existing documents table (if any)...');
    await client.query('DROP TABLE IF EXISTS documents;');

    // Create the documents table with vector extension
    logger.info('Creating documents table with vector extension...');
    await client.query('CREATE EXTENSION IF NOT EXISTS vector;');
    await client.query(`
      CREATE TABLE documents (
        id SERIAL PRIMARY KEY,
        source TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding VECTOR(1536),
        metadata JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        last_update TIMESTAMPTZ
      );
    `);

    logger.info('Test database setup completed successfully.');
  } catch (err) {
    logger.error('Test database setup failed:', err);
  } finally {
    await client.end();
    logger.info('Database connection closed.');
  }
}

void setupTestDb();
