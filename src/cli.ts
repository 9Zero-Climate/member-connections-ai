import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';
import { Client } from 'pg';
import { ConfigContext, createConfig } from './config'; // Import createConfig instead of config
import { syncSlackChannel } from './scripts/sync/slack';
import { logger } from './services/logger';

const program = new Command();

program.name('member-connections-ai').description('CLI tool for member connections AI');

program
  .command('sync-channel')
  .description('Sync messages from a specific Slack channel')
  .argument('<channelName>', 'Name of the channel to sync')
  .option('-l, --limit <number>', 'Maximum number of messages to sync', '1000')
  .option('-o, --oldest <timestamp>', 'Start time in Unix timestamp')
  .option('-n, --newest <timestamp>', 'End time in Unix timestamp')
  .option('-b, --batch-size <number>', 'Number of messages to process in each batch', '50')
  .action(syncSlackChannel);

program
  .command('run-migration')
  .description('Run a single SQL migration file')
  .argument('<filePath>', 'Path to the SQL migration file')
  .action(async (filePath: string) => {
    const config = createConfig(process.env, ConfigContext.Migrate);

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
    } catch (err) {
      const errorMessage =
        typeof err === 'object' && err !== null && 'message' in err ? (err as Error).message : String(err);
      logger.error(`Migration failed: ${errorMessage}`, err);
      process.exit(1);
    } finally {
      if (client) {
        await client.end();
        logger.info('Database connection closed.');
      }
    }
  });

program.parse();
