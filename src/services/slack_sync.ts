import * as fs from 'node:fs';
import path from 'node:path';
import { WebClient } from '@slack/web-api';
import type { MessageElement } from '@slack/web-api/dist/types/response/ConversationsHistoryResponse';
import { config } from '../config';
import { logger } from './logger';

import { limitFunction } from 'p-limit';

let client: WebClient | null = null;

type SlackSyncOptions = {
  oldest?: string;
  latest?: string;
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
   * @param {Object} syncOptions - Fetch options
   * @param {string} syncOptions.oldest - Start time in Unix timestamp
   * @param {string} syncOptions.newest - End time in Unix timestamp
   * @returns {Promise<MessageElement>} Array of raw slack messages
   */
  async fetchChannelHistory(channelId: string, syncOptions: SlackSyncOptions = {}): Promise<MessageElement[]> {
    const messages: MessageElement[] = [];
    let cursor: string | undefined;

    await this.joinChannel(channelId);

    do {
      const result = await getClient().conversations.history({
        channel: channelId,
        cursor,
        ...syncOptions,
      });

      if (result.messages) {
        messages.push(...result.messages);
      }
      cursor = result.response_metadata?.next_cursor;
    } while (cursor);

    logger.info(`Fetched ${messages.length} messages`);

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
    logger.info(`Found channel ID: ${channel.id}`);
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

  async getPermalinkOrNull(channelId: string, message: UsableSlackMessage): Promise<string | null> {
    try {
      const result = await getClient().chat.getPermalink({
        channel: channelId,
        message_ts: message.ts,
      });
      return result.permalink || null;
    } catch (error) {
      logger.warn({ err: error, channelId, message }, 'Error while fetching permalink');
      return null;
    }
  },

  async formatMessage(channelId: string, message: UsableSlackMessage): Promise<FormattedSlackMessage> {
    // The call to the Slack API chat.getPermalink is rate-limited, and if we kick off all the promises
    // at once, we hit the rate limits. Instead, use p-limit to limit the concurrency of those promises
    const limitedGetPermalink = limitFunction(this.getPermalinkOrNull, { concurrency: 10 });
    const permalink = await limitedGetPermalink(channelId, message);
    return {
      ts: this.tsToISOString(message.ts),
      text: message.text,
      user: message.user,
      thread_ts: message.thread_ts,
      permalink,
    };
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

    logger.info(`Formatting & fetching permalinks for ${validMessages.length} valid messages`);

    const formattedMessages = Promise.all(validMessages.map((message) => this.formatMessage(channelId, message)));

    return formattedMessages;
  },
};

export default { ...slackSync, setTestClient };
export type { FormattedSlackMessage, SlackSyncOptions };

/**
 * Extracts Slack messages for a given channel from a folder of exported data.
 * Expects the export to be a directory in the format:
 *  /<export name>
 *    /<channel-name-a>
 *      <date1>.json
 *      <date2>.json
 *    /<channel-name-b>
 *      <date1>.json
 *      <date2>.json
 *
 * Where the content of the .json files is a MessageElement[]
 */

export const extractChannelMessagesFromSlackHistoryExport = async (
  exportDirectoryPath: string,
  channelName: string,
): Promise<MessageElement[]> => {
  const channelExportDirectoryPath = path.join(exportDirectoryPath, channelName);
  logger.info(`Extracting messages for ${channelName} channel at path: ${channelExportDirectoryPath}`);
  const jsonFileNames = fs.readdirSync(channelExportDirectoryPath).filter((fileName) => fileName.endsWith('.json'));

  const messages = jsonFileNames.flatMap((fileName) => {
    const filePath = path.join(channelExportDirectoryPath, fileName);
    const fileContents = fs.readFileSync(filePath, 'utf-8');
    const jsonData = JSON.parse(fileContents);
    return jsonData;
  });

  logger.info(`Extracted ${messages.length} messages`);

  return messages;
};
