import * as fs from 'node:fs';
import * as path from 'node:path';
import * as dotenv from 'dotenv';
import { Client } from 'pg';
import { ConfigContext, createValidConfig } from '../../config';
import { logger } from '../../services/logger';

// Load environment variables
dotenv.config();

/**
 * Run a single SQL migration file
 * @param filePath - Path to the SQL migration file
 */
export async function migrate(filePath: string): Promise<void> {
  logger.info('Starting migration...');
  const config = createValidConfig(process.env, ConfigContext.Migrate);

  const absoluteMigrationPath = path.resolve(filePath);
  logger.info(`Attempting to run migration: ${absoluteMigrationPath}`);

  if (!fs.existsSync(absoluteMigrationPath)) {
    logger.error(`Error: Migration file not found at ${absoluteMigrationPath}`);
    process.exit(1);
  }

  const client = new Client({
    connectionString: config.dbUrl,
  });

  try {
    await client.connect();
    logger.info('Connected to database for migration.');

    const migrationQuery = fs.readFileSync(absoluteMigrationPath, 'utf8');
    logger.info(`Read migration file: ${path.basename(absoluteMigrationPath)}`);

    logger.info(`Running migration from ${path.basename(absoluteMigrationPath)}...`);
    await client.query(migrationQuery);
    logger.info(`Migration from ${path.basename(absoluteMigrationPath)} completed successfully.`);
    process.exit(0);
  } catch (error) {
    const errorMessage =
      typeof error === 'object' && error !== null && 'message' in error ? (error as Error).message : String(error);
    logger.error(error, `Migration failed: ${errorMessage}`);
    process.exit(1);
  } finally {
    if (client) {
      await client.end();
      logger.info('Database connection closed.');
    }
  }
  logger.info('Migration complete');
}

export async function migrateAll() {
  console.log('Running all migrations');
  const config = createValidConfig(process.env, ConfigContext.Migrate);

  if (process.env.NODE_ENV === 'production' || process.env.DB_URL?.includes('supabase.com')) {
    console.error(`Detected production NODE_ENV or supabase DB_URL. Don't run this in production! Exiting`);
    process.exit(1);
  }

  const client = new Client({ connectionString: config.dbUrl });

  try {
    await client.connect();

    // Get all migration files
    const migrationsDir = path.join(__dirname, '..', '..', 'migrations');
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
    console.error('Error running migrations:', error);
    process.exit(1);
  } finally {
    client.end();
  }
}
