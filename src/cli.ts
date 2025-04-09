import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';
import { Client } from 'pg';
import { config } from './config'; // Import unified config
import { type Document, getDocBySource, insertOrUpdateDoc } from './services/database';
import { logger } from './services/logger';
import slackSync, { doesSlackMessageMatchDb } from './services/slack_sync';
import type { SlackMessage } from './services/slack_sync';

interface SyncOptions {
  limit: string;
  oldest?: string;
  newest?: string;
  batchSize: string;
}

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
  .action(async (channelName: string, options: SyncOptions) => {
    try {
      console.log(`Syncing channel: ${channelName}`);

      // Get channel ID
      const channelId = await slackSync.getChannelId(channelName);
      console.log(`Found channel ID: ${channelId}`);

      // Fetch messages
      const messages = await slackSync.fetchChannelHistory(channelId, {
        limit: Number.parseInt(options.limit),
        oldest: options.oldest,
        latest: options.newest,
      });
      console.log(`Fetched ${messages.length} messages`);

      // Process messages in batches
      const batchSize = Number.parseInt(options.batchSize);
      const batches: SlackMessage[][] = [];
      for (let i = 0; i < messages.length; i += batchSize) {
        batches.push(messages.slice(i, i + batchSize));
      }

      console.log(`Processing ${batches.length} batches of ${batchSize} messages each`);

      for (const [batchIndex, batch] of batches.entries()) {
        console.log(`Processing batch ${batchIndex + 1}/${batches.length}`);

        // Process batch (format + generate embeddings)
        const processedMessages = await slackSync.processMessageBatch(batch, channelId);

        // Store messages
        for (const msg of processedMessages) {
          // Construct the source_unique_id (assuming it's channelId:ts)
          const sourceUniqueId = `${channelId}:${msg.metadata.ts}`;
          // Construct the document to upsert, matching the Document type
          const docToUpsert: Document = {
            source_type: 'slack', // Assuming slack source type
            source_unique_id: sourceUniqueId,
            content: msg.content,
            embedding: msg.embedding,
            metadata: msg.metadata,
          };

          // Check if document already exists and content/metadata has changed
          const existingDoc = await getDocBySource(sourceUniqueId);
          // Pass the properly formatted docToUpsert to the comparison function
          if (existingDoc && doesSlackMessageMatchDb(existingDoc, docToUpsert)) {
            console.log(`Skipping unchanged document ${sourceUniqueId}`);
            continue;
          }

          if (existingDoc) {
            console.log('Documents considered different:');
            console.log(JSON.stringify({ existingDoc, newDoc: docToUpsert }, null, 2));
          }

          // Insert or update document using the correctly formatted object
          await insertOrUpdateDoc(docToUpsert);
          console.log(`${existingDoc ? 'Updated' : 'Inserted'} document ${sourceUniqueId}`);
        }

        console.log(`Completed batch ${batchIndex + 1}`);
      }

      console.log(`Successfully synced ${messages.length} messages to database`);
      process.exit(0);
    } catch (error) {
      console.error('Error syncing channel:', error);
      process.exit(1);
    }
  });

program
  .command('run-migration')
  .description('Run a single SQL migration file')
  .argument('<filePath>', 'Path to the SQL migration file')
  .action(async (filePath: string) => {
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
