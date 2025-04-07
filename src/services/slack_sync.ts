import { isDeepStrictEqual } from 'node:util';
import { WebClient } from '@slack/web-api';
import { config } from '../config';
import type { Document } from './database';
import { generateEmbeddings } from './embedding';
import { logger } from './logger';

let client: WebClient | null = null;

interface FetchOptions {
  limit?: number;
  oldest?: string;
  latest?: string;
}

interface SlackSyncOptions extends FetchOptions {}

interface SlackMessage {
  ts: string;
  text?: string;
  user?: string;
  thread_ts?: string;
  reply_count?: number;
  reactions?: Array<{ name: string; count: number }>;
  type?: string;
  subtype?: string;
  channel?: string;
  team?: string;
}

interface FormattedMessage {
  source: string;
  content: string;
  metadata: {
    ts: string;
    thread_ts?: string;
    channel: string;
    user?: string;
    permalink: string;
    channelName: string;
  };
}

interface SlackError extends Error {
  data?: {
    error?: string;
  };
}

/**
 * Initialize or get the Slack client
 * @returns {WebClient} The Slack client instance
 */
function getClient(): WebClient {
  if (!client) {
    client = new WebClient(config.slackBotToken);
  }
  return client;
}

/**
 * Set a test client for testing purposes
 * @param {WebClient} testClient - The test client to use
 */
function setTestClient(testClient: WebClient): void {
  client = testClient;
}

/**
 * Service for syncing Slack channel content
 */
const slackSync = {
  /**
   * Join a channel if not already a member
   * @param {string} channelId - The channel ID to join
   * @returns {Promise<void>}
   */
  async joinChannel(channelId: string): Promise<void> {
    try {
      await getClient().conversations.join({ channel: channelId });
    } catch (error) {
      if ((error as SlackError).data?.error !== 'already_in_channel') {
        throw error;
      }
    }
  },

  /**
   * Fetch messages from a channel
   * @param {string} channelId - The channel ID to fetch from
   * @param {Object} options - Fetch options
   * @param {number} options.limit - Maximum number of messages to fetch
   * @param {string} options.oldest - Start time in Unix timestamp
   * @param {string} options.latest - End time in Unix timestamp
   * @returns {Promise<Array>} Array of messages
   */
  async fetchChannelHistory(channelId: string, options: FetchOptions = {}): Promise<SlackMessage[]> {
    const { limit = 1000, oldest, latest } = options;
    const messages: SlackMessage[] = [];
    let cursor: string | undefined;

    await this.joinChannel(channelId);

    do {
      const result = await getClient().conversations.history({
        channel: channelId,
        limit: Math.min(limit - messages.length, 100),
        cursor,
        oldest,
        latest,
      });

      messages.push(...(result.messages as SlackMessage[]));
      cursor = result.response_metadata?.next_cursor;
    } while (cursor && messages.length < limit);

    return messages;
  },

  /**
   * Get channel ID from channel name
   * @param {string} channelName - Channel name (e.g., 'introductions')
   * @returns {Promise<string>} Channel ID
   */
  async getChannelId(channelName: string): Promise<string> {
    const result = await getClient().conversations.list();
    const channels = result.channels || [];
    const channel = channels.find((c) => c.name === channelName);
    if (!channel?.id) {
      throw new Error(`Channel '${channelName}' not found`);
    }
    return channel.id;
  },

  /**
   * Get channel name from channel ID
   * @param {string} channelId - Channel ID
   * @returns {Promise<string>} Channel name
   */
  async getChannelName(channelId: string): Promise<string> {
    const result = await getClient().conversations.info({ channel: channelId });
    if (!result.channel?.name) {
      throw new Error(`Channel name not found for ID '${channelId}'`);
    }
    return result.channel.name;
  },

  /**
   * Convert Slack timestamp to ISO string
   * @param {string} ts - Slack timestamp (Unix timestamp with microseconds)
   * @returns {string} ISO string
   */
  tsToISOString(ts: string): string {
    const milliseconds = Number.parseFloat(ts) * 1000;
    return new Date(milliseconds).toISOString();
  },

  /**
   * Format message for database storage
   * @param {Object} message - Slack message object
   * @param {string} channelId - Channel ID
   * @returns {Object} Formatted message
   */
  async formatMessage(message: SlackMessage, channelId: string): Promise<FormattedMessage | null> {
    if (!message.text?.trim()) {
      return null;
    }

    const [permalinkResult, channelName] = await Promise.all([
      getClient().chat.getPermalink({
        channel: channelId,
        message_ts: message.ts,
      }),
      this.getChannelName(channelId),
    ]);

    let userProfile: { display_name?: string; real_name?: string } | undefined;
    if (message.user) {
      try {
        const userInfo = await getClient().users.info({ user: message.user });
        if (userInfo.ok && userInfo.user) {
          userProfile = userInfo.user.profile;
        }
      } catch (err) {
        logger.warn(`Failed to get user info for ${message.user}:`, err);
      }
    }
    const userDisplayName = userProfile?.display_name;
    const userRealName = userProfile?.real_name;

    return {
      source: 'slack',
      content: message.text,
      metadata: {
        ts: this.tsToISOString(message.ts),
        thread_ts: message.thread_ts,
        channel: channelId,
        user: message.user,
        permalink: permalinkResult.permalink ?? '',
        channelName: channelName,
      },
    };
  },

  /**
   * Process a batch of messages and generate embeddings
   * @param {Array} messages - Array of Slack messages
   * @param {string} channelId - Channel ID
   * @returns {Promise<Array>} Array of formatted messages with embeddings
   */
  async processMessageBatch(
    messages: SlackMessage[],
    channelId: string,
  ): Promise<(FormattedMessage & { embedding: number[] })[]> {
    const formattedMessages = await Promise.all(messages.map((msg) => this.formatMessage(msg, channelId)));

    const canHandleMessage = (msg: FormattedMessage | null): msg is FormattedMessage => msg !== null;

    const validMessages = formattedMessages.filter(canHandleMessage);
    const unhandledMessages = formattedMessages.filter((msg) => !canHandleMessage(msg));
    logger.warn(`Unhandled messages: ${JSON.stringify(unhandledMessages)}`);

    const embeddings = await generateEmbeddings(validMessages.map((msg) => msg.content));
    return validMessages.map((msg, index) => ({
      ...msg,
      embedding: embeddings[index],
    }));
  },
};

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

export default { ...slackSync, setTestClient };
export type { SlackMessage, FormattedMessage, FetchOptions };
