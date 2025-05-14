import { isDeepStrictEqual } from 'node:util';
import { ConfigContext, validateConfig } from '../config';
import { type Document, closeDbConnection, getDocBySource, insertOrUpdateDoc } from '../services/database';
import { logger } from '../services/logger';
import slackSync, { extractChannelMessagesFromSlackHistoryExport } from '../services/slack_sync';
import type { FormattedSlackMessage, SlackSyncOptions } from '../services/slack_sync';

const defaultSyncOptions: SlackSyncOptions = {
  oldest: undefined,
  latest: undefined,
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
  logger.info(`Upserting (up to) ${processedMessages.length} messages as RAG Docs`);

  const docsToMaybeUpsert: SlackMessageRagDoc[] = processedMessages.map((message) => {
    return {
      source_type: 'slack',
      source_unique_id: `${channelId}:${message.ts}`,
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
  });
  const existingDocs = await Promise.all(
    docsToMaybeUpsert.map((docToUpsert) => getDocBySource(docToUpsert.source_unique_id)),
  );

  const docsToSkip: SlackMessageRagDoc[] = [];
  const docsToUpdate: SlackMessageRagDoc[] = [];
  const docsToInsert: SlackMessageRagDoc[] = [];

  docsToMaybeUpsert.forEach((docToMaybeUpsert, index) => {
    const existingDoc = existingDocs[index];
    const isUnchanged = existingDoc && doesSlackMessageMatchDb(existingDoc, docToMaybeUpsert);

    if (!existingDoc) {
      docsToInsert.push(docToMaybeUpsert);
    } else if (existingDoc && isUnchanged) {
      docsToSkip.push(docToMaybeUpsert);
    } else {
      docsToUpdate.push(docToMaybeUpsert);
    }
  });

  logger.info(
    { sourceIds: docsToSkip.map((doc) => doc.source_unique_id) },
    `Skipping ${docsToSkip.length} unchanged documents`,
  );
  logger.info(
    { sourceIds: docsToInsert.map((doc) => doc.source_unique_id) },
    `Inserting ${docsToInsert.length} new documents`,
  );
  await Promise.all(docsToUpdate.map((doc) => insertOrUpdateDoc(doc)));

  logger.info(
    { sourceIds: docsToInsert.map((doc) => doc.source_unique_id) },
    `Updating ${docsToUpdate.length} changed documents`,
  );
  await Promise.all(docsToInsert.map((doc) => insertOrUpdateDoc(doc)));
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
 * @param existingDoc - Document from the database
 * @param newDoc - Newly processed document straight from Slack
 * @returns boolean indicating if the documents are semantically equal. If false, the DB should be updated with the newDoc.
 */
export function doesSlackMessageMatchDb(existingDoc: Document, newDoc: Document): boolean {
  if (existingDoc.content !== newDoc.content) {
    logger.debug(
      { existingDocContent: existingDoc.content, newDocContent: newDoc.content },
      'New doc content does not match existing doc',
    );
    return false;
  }

  const cleanMetadata = (metadata: Record<string, unknown> | undefined): Record<string, unknown> => {
    if (!metadata) return {};
    const entries = Object.entries(metadata).filter(([_, value]) => value !== undefined && value !== null);
    return Object.fromEntries(entries);
  };

  const dbMeta = cleanMetadata(existingDoc.metadata);
  const newMeta = cleanMetadata(newDoc.metadata);

  if (!isDeepStrictEqual(dbMeta, newMeta)) {
    logger.debug(
      JSON.stringify({ existingDoc: { ...existingDoc, embedding: undefined }, newDoc }, null, 2),
      'New doc metadata does not match existing doc',
    );
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

      // Fetch messages
      const messages = await slackSync.fetchChannelHistory(channelId, syncOptions);

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

/**
 * Imports data from a full slack history export. Expects the export to be a directory in the format:
 * /<export name>
 *   /<channel-name-a>
 *     <date1>.json
 *     <date2>.json
 *   /<channel-name-b>
 *     <date1>.json
 *     <date2>.json
 *
 * Where the content of the .json files is a MessageElement[]
 */
export const importSlackHistory = async (exportDirectoryPath: string, channelNames: string[]): Promise<void> => {
  logger.info(`Starting import for channels: ${channelNames.join(', ')}`);

  try {
    validateConfig(process.env, ConfigContext.SyncSlack);

    for (const channelName of channelNames) {
      logger.info(`Importing channel: ${channelName}`);

      const channelId = await slackSync.getChannelId(channelName);

      // Exract messages
      const messages = await extractChannelMessagesFromSlackHistoryExport(exportDirectoryPath, channelName);

      // Process messages into a shape we can use
      const formattedMessages = await slackSync.processMessages(messages, channelId);

      // Upsert those messages as RAG docs (only if changed or new)
      await upsertSlackMessagesRagDocs(formattedMessages, channelName, channelId);

      logger.info(`Successfully imported ${formattedMessages.length} messages to database`);
    }
  } finally {
    await closeDbConnection();
  }

  logger.info('Slack import complete');
};
