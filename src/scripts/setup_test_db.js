const { Client } = require('pg');
const { config } = require('dotenv');
const fs = require('node:fs');
const path = require('node:path');

// Load environment variables
config();

async function setupTestDb() {
  const client = new Client({
    connectionString: process.env.DB_URL,
  });

  try {
    await client.connect();
    console.log('Connected to test database');

    // Create the pgvector extension
    await client.query('CREATE EXTENSION IF NOT EXISTS vector;');
    console.log('pgvector extension created successfully');

    // Get all migration files
    const migrationsDir = path.join(__dirname, '..', 'migrations');
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
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

setupTestDb();
