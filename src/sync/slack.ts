import { ConfigContext, validateConfig } from '../config';
import { type Document, closeDbConnection, getDocBySource, insertOrUpdateDoc } from '../services/database';
import { logger } from '../services/logger';
import slackSync, { doesSlackMessageMatchDb } from '../services/slack_sync';
import type { SlackMessage } from '../services/slack_sync';

interface SlackSyncOptions {
  limit: number;
  oldest?: string;
  newest?: string;
  batchSize: number;
}

const defaultSyncOptions: SlackSyncOptions = {
  limit: 1000,
  batchSize: 50,
};

async function processMessages(messages: SlackMessage[], channelId: string, batchSize: number) {
  // Process messages in batches
  const batches: SlackMessage[][] = [];
  for (let i = 0; i < messages.length; i += batchSize) {
    batches.push(messages.slice(i, i + batchSize));
  }

  logger.info(`Processing ${batches.length} batches of ${batchSize} messages each`);

  for (const [batchIndex, batch] of batches.entries()) {
    logger.info(`Processing batch ${batchIndex + 1}/${batches.length}`);

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
        logger.info(`Skipping unchanged document ${sourceUniqueId}`);
        continue;
      }

      if (existingDoc) {
        logger.info('Documents considered different:');
        logger.info(JSON.stringify({ existingDoc, newDoc: docToUpsert }, null, 2));
      }

      // Insert or update document using the correctly formatted object
      await insertOrUpdateDoc(docToUpsert);
      logger.info(`${existingDoc ? 'Updated' : 'Inserted'} document ${sourceUniqueId}`);
    }

    logger.info(`Completed batch ${batchIndex + 1}`);
  }
}

/**
 * Sync data from Slack
 */
export async function syncSlackChannels(channelNames: string[], syncOptionOverrides?: SlackSyncOptions): Promise<void> {
  logger.info(`Starting Slack sync for channels: ${channelNames.join(', ')}`);

  const syncOptions = { ...defaultSyncOptions, ...syncOptionOverrides };
  const { limit, oldest, newest: latest, batchSize } = syncOptions;

  try {
    validateConfig(process.env, ConfigContext.SyncSlack);

    for (const channelName of channelNames) {
      logger.info(`Syncing channel: ${channelName}`);
      // Get channel ID
      const channelId = await slackSync.getChannelId(channelName);
      logger.info(`Found channel ID: ${channelId}`);

      // Fetch messages
      const messages = await slackSync.fetchChannelHistory(channelId, { limit, oldest, latest });
      logger.info(`Fetched ${messages.length} messages`);

      await processMessages(messages, channelId, batchSize);

      logger.info(`Successfully synced ${messages.length} messages to database`);
    }
  } finally {
    await closeDbConnection();
  }

  logger.info('Slack sync complete');
}
