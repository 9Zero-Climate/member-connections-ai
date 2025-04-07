import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from 'pg';
import { config } from '../config'; // Import unified config
import { logger } from '../services/logger';

async function runMigration(): Promise<void> {
  const client = new Client({
    connectionString: config.dbUrl, // Use config
  });

  try {
    await client.connect();
    logger.info('Connected to database for migration.');

    // Example Migration: Add a new column to the documents table
    // Replace this with your actual migration logic
    const migrationQuery = `
      ALTER TABLE documents
      ADD COLUMN IF NOT EXISTS example_column VARCHAR(255);
    `;

    logger.info('Running migration...');
    await client.query(migrationQuery);
    logger.info('Migration completed successfully.');
  } catch (err) {
    logger.error('Migration failed:', err);
  } finally {
    await client.end();
    logger.info('Database connection closed.');
  }
}

void runMigration();

export { runMigration };
