import * as fs from 'node:fs';
import * as path from 'node:path';
import { config } from 'dotenv';
import { Client } from 'pg';

// Load environment variables
config();

async function runMigration() {
  const client = new Client({
    connectionString: process.env.DB_URL,
  });

  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected successfully');

    // Read and execute the migration file
    const migrationPath = path.join(__dirname, '../migrations/20240331_create_members_table.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');

    console.log('Running migration...');
    await client.query(migrationSql);
    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Error running migration:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  runMigration();
}

export { runMigration };
