import { ConfigContext, validateConfig } from '../../config';
import { type Document, getDocBySource, insertOrUpdateDoc } from '../../services/database';
import { logger } from '../../services/logger';
import slackSync, { doesSlackMessageMatchDb } from '../../services/slack_sync';
import type { SlackMessage } from '../../services/slack_sync';

interface SyncOptions {
  limit: string;
  oldest?: string;
  newest?: string;
  batchSize: string;
}

/**
 * Sync data from Slack
 */
export async function syncSlackChannel(channelName: string, options: SyncOptions): Promise<void> {
  logger.info('Starting Slack sync...');
  // Run config loader to validate required config
  validateConfig(process.env, ConfigContext.SyncSlack);

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
  logger.info('Slack sync complete');
}
