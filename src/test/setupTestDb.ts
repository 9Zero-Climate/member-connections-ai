import { Client } from 'pg';

import fs from 'node:fs';
import * as path from 'node:path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export async function runMigrations() {
  if (process.env.NODE_ENV === 'production' || process.env.DB_URL?.includes('supabase.com')) {
    console.error(`Don't run this in production! Exiting`);
    process.exit(1);
  }

  const client = new Client({
    connectionString: process.env.DB_URL,
  });

  try {
    await client.connect();
    console.log('Connected to test database');

    // Get all migration files
    const migrationsDir = path.join(__dirname, '..', 'migrations');
    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort(); // Ensure migrations run in order

    // Run each migration
    for (const file of migrationFiles) {
      console.log(`Running migration: ${file}`);
      const migration = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query(migration);
    }

    console.log('All migrations completed successfully');
  } catch (error) {
    console.error('Error setting up test database:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigrations();
