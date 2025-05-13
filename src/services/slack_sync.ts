import { WebClient } from '@slack/web-api';
import { config } from '../config';
import { logger } from './logger';
import type { MessageElement } from '@slack/web-api/dist/types/response/ConversationsHistoryResponse';

let client: WebClient | null = null;

type SlackSyncOptions = {
  maxMessages?: number;
  oldest?: string;
  newest?: string;
};

type UsableSlackMessage = MessageElement & {
  ts: string;
  text: string;
};

type FormattedSlackMessage = {
  ts: string;
  text: string;
  permalink: string | null;
  user?: string;
  thread_ts?: string;
};

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
   * @param {number} options.maxMessages - Maximum number of messages to fetch. If not provided, will fetch as far back as Slack's API will return
   * @param {string} options.oldest - Start time in Unix timestamp
   * @param {string} options.newest - End time in Unix timestamp
   * @returns {Promise<MessageElement>} Array of raw slack messages
   */
  async fetchChannelHistory(channelId: string, options: SlackSyncOptions = {}): Promise<MessageElement[]> {
    const { maxMessages, oldest, newest } = options;
    const messages: MessageElement[] = [];
    let cursor: string | undefined;

    await this.joinChannel(channelId);

    do {
      const limit = maxMessages ? Math.min(maxMessages - messages.length, 100) : undefined;
      const result = await getClient().conversations.history({
        channel: channelId,
        limit,
        cursor,
        oldest,
        latest: newest,
      });

      if (result.messages) {
        messages.push(...result.messages);
      }
      cursor = result.response_metadata?.next_cursor;
    } while (cursor && (maxMessages ? messages.length < maxMessages : true));

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
   * Process raw Slack messages:
   *  - filter down to usable messages
   *  - attach permalinks
   */
  async processMessages(messages: MessageElement[], channelId: string): Promise<FormattedSlackMessage[]> {
    const canHandleMessage = (message: MessageElement): message is UsableSlackMessage =>
      message.ts != null && message.text?.trim() != null;

    const unhandledMessages = messages.filter((msg) => !canHandleMessage(msg));
    if (unhandledMessages.length > 0) {
      logger.warn(`Unhandled messages: ${JSON.stringify(unhandledMessages)}`);
    }

    const validMessages = messages.filter(canHandleMessage);

    const permalinkResults = await Promise.all(
      validMessages.map((message) => {
        return getClient().chat.getPermalink({
          channel: channelId,
          message_ts: message.ts,
        });
      }),
    );

    const formattedMessages = validMessages.map((message, index) => ({
      ts: this.tsToISOString(message.ts),
      text: message.text,
      user: message.user,
      thread_ts: message.thread_ts,
      permalink: permalinkResults[index].permalink ?? null,
    }));

    return formattedMessages;
  },
};

export default { ...slackSync, setTestClient };
export type { FormattedSlackMessage, SlackSyncOptions };
