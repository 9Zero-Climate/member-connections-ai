import { Command } from 'commander';
import { getDocBySource, insertOrUpdateDoc } from './services/database';
import slackSync from './services/slack_sync';
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
  .option('-l, --limit <number>', 'Maximum number of messages to sync', '100')
  .option('-o, --oldest <timestamp>', 'Start time in Unix timestamp')
  .option('-n, --newest <timestamp>', 'End time in Unix timestamp')
  .option('-b, --batch-size <number>', 'Number of messages to process in each batch', '10')
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
          // Check if document already exists and content/metadata has changed
          const existingDoc = await getDocBySource(msg.source_unique_id);
          if (
            existingDoc &&
            existingDoc.content === msg.content &&
            JSON.stringify(existingDoc.metadata) === JSON.stringify(msg.metadata)
          ) {
            console.log(`Skipping unchanged document ${msg.source_unique_id}`);
            continue;
          }

          // Insert or update document
          await insertOrUpdateDoc(msg);
          console.log(`${existingDoc ? 'Updated' : 'Inserted'} document ${msg.source_unique_id}`);
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

program.parse();
