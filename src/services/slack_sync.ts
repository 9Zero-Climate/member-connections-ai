import { WebClient } from '@slack/web-api';
import { config } from 'dotenv';
import { getDocBySource } from './database';
import { generateEmbeddings } from './embedding';

// config();

let client: WebClient | null = null;

interface FetchOptions {
  limit?: number;
  oldest?: string;
  latest?: string;
}

interface SlackMessage {
  ts: string;
  text: string;
  user: string;
  thread_ts?: string;
  reply_count?: number;
  reactions?: Array<{ name: string; count: number }>;
}

interface FormattedMessage {
  source_type: string;
  source_unique_id: string;
  content: string;
  metadata: {
    user: string;
    channel: string;
    channel_name?: string;
    thread_ts?: string;
    reply_count?: number;
    reactions?: Array<{ name: string; count: number }>;
    permalink?: string;
    datetime?: string;
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
    client = new WebClient(process.env.SLACK_BOT_TOKEN);
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
      // Ignore "already_in_channel" errors
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

    // Join the channel first
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
    // Convert microseconds to milliseconds
    const milliseconds = Number.parseFloat(ts) * 1000;
    return new Date(milliseconds).toISOString();
  },

  /**
   * Format message for database storage
   * @param {Object} message - Slack message object
   * @param {string} channelId - Channel ID
   * @returns {Object} Formatted message
   */
  async formatMessage(message: SlackMessage, channelId: string): Promise<FormattedMessage> {
    // Get the permalink for the message
    const [permalinkResult, channelName] = await Promise.all([
      getClient().chat.getPermalink({
        channel: channelId,
        message_ts: message.ts,
      }),
      this.getChannelName(channelId),
    ]);

    return {
      source_type: 'slack',
      source_unique_id: `${channelId}:${message.ts}`,
      content: message.text,
      metadata: {
        user: message.user,
        channel: channelId,
        channel_name: channelName,
        thread_ts: message.thread_ts,
        reply_count: message.reply_count,
        reactions: message.reactions,
        permalink: permalinkResult.permalink,
        datetime: this.tsToISOString(message.ts),
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
    const embeddings = await generateEmbeddings(formattedMessages.map((msg) => msg.content));
    return formattedMessages.map((msg, index) => ({
      ...msg,
      embedding: embeddings[index],
    }));
  },
};

export default { ...slackSync, setTestClient };
export type { SlackMessage, FormattedMessage, FetchOptions };
