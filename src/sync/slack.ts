import { isDeepStrictEqual } from 'node:util';
import { ConfigContext, validateConfig } from '../config';
import { type Document, closeDbConnection, getDocBySource, insertOrUpdateDoc } from '../services/database';
import { logger } from '../services/logger';
import slackSync from '../services/slack_sync';
import type { FormattedSlackMessage, SlackSyncOptions } from '../services/slack_sync';

const defaultSyncOptions: SlackSyncOptions = {
  maxMessages: undefined,
  oldest: undefined,
  newest: undefined,
};

type SlackMessageRagDoc = Document & {
  source_type: 'slack';
  metadata: {
    ts: string;
    channelId: string;
    channelName: string;
    permalink: string | null;
    user?: string;
    thread_ts?: string;
  };
};

export async function upsertSlackMessagesRagDocs(
  processedMessages: FormattedSlackMessage[],
  channelName: string,
  channelId: string,
) {
  for (const message of processedMessages) {
    const sourceUniqueId = `${channelId}:${message.ts}`;

    const docToUpsert: SlackMessageRagDoc = {
      source_type: 'slack',
      source_unique_id: sourceUniqueId,
      content: message.text,
      metadata: {
        ts: message.ts,
        thread_ts: message.thread_ts,
        channelId,
        channelName,
        user: message.user,
        permalink: message.permalink,
      },
    };

    // Don't try to upsert doc if it already exists and nothing has changed
    const existingDoc = await getDocBySource(sourceUniqueId);
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
}

/**
 * Compares two documents for semantic equality, ignoring:
 * - Database-specific fields (created_at, updated_at)
 * - Undefined/null metadata fields
 * - Embedding data
 *
 * This is specifically designed for Slack message comparison where certain
 * fields (like thread_ts, reply_count) may be undefined in new messages
 * but null/missing in stored documents.
 *
 * @param msgDocInDb - Document from the database
 * @param newDoc - Newly processed document straight from Slack
 * @returns boolean indicating if the documents are semantically equal. If false, the DB should be updated with the newDoc.
 */
export function doesSlackMessageMatchDb(msgDocInDb: Document, newDoc: Document): boolean {
  if (msgDocInDb.content !== newDoc.content) {
    console.log('Content mismatch');
    return false;
  }

  const cleanMetadata = (metadata: Record<string, unknown> | undefined): Record<string, unknown> => {
    if (!metadata) return {};
    const entries = Object.entries(metadata).filter(([_, value]) => value !== undefined && value !== null);
    return Object.fromEntries(entries);
  };

  const dbMeta = cleanMetadata(msgDocInDb.metadata);
  const newMeta = cleanMetadata(newDoc.metadata);

  if (!isDeepStrictEqual(dbMeta, newMeta)) {
    logger.debug('Metadata mismatch');
    return false;
  }

  return true;
}

/**
 * Sync data from Slack
 */
export async function syncSlackChannels(channelNames: string[], syncOptionOverrides?: SlackSyncOptions): Promise<void> {
  logger.info(`Starting Slack sync for channels: ${channelNames.join(', ')}`);

  const syncOptions = { ...defaultSyncOptions, ...syncOptionOverrides };

  try {
    validateConfig(process.env, ConfigContext.SyncSlack);

    for (const channelName of channelNames) {
      logger.info(`Syncing channel: ${channelName}`);

      const channelId = await slackSync.getChannelId(channelName);
      logger.info(`Found channel ID: ${channelId}`);

      // Fetch messages
      const messages = await slackSync.fetchChannelHistory(channelId, syncOptions);
      logger.info(`Fetched ${messages.length} messages`);

      // Process messages into a shape we can use
      const formattedMessages = await slackSync.processMessages(messages, channelId);

      // Upsert those messages as RAG docs (only if changed or new)
      await upsertSlackMessagesRagDocs(formattedMessages, channelName, channelId);

      logger.info(`Successfully synced ${formattedMessages.length} messages to database`);
    }
  } finally {
    await closeDbConnection();
  }

  logger.info('Slack sync complete');
}
