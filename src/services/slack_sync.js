const { WebClient } = require('@slack/web-api');
const { config } = require('dotenv');
const { generateEmbeddings } = require('./embedding.js');
const { getDocBySource } = require('./database');

config();

let client = null;

/**
 * Initialize or get the Slack client
 * @returns {WebClient} The Slack client instance
 */
function getClient() {
  if (!client) {
    client = new WebClient(process.env.SLACK_BOT_TOKEN);
  }
  return client;
}

/**
 * Set a test client for testing purposes
 * @param {WebClient} testClient - The test client to use
 */
function setTestClient(testClient) {
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
  async joinChannel(channelId) {
    try {
      await getClient().conversations.join({ channel: channelId });
    } catch (error) {
      // Ignore "already_in_channel" errors
      if (error.data?.error !== 'already_in_channel') {
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
  async fetchChannelHistory(channelId, options = {}) {
    const { limit = 100, oldest, latest } = options;
    const messages = [];
    let cursor;

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

      messages.push(...result.messages);
      cursor = result.response_metadata?.next_cursor;
    } while (cursor && messages.length < limit);

    return messages;
  },

  /**
   * Get channel ID from channel name
   * @param {string} channelName - Channel name (e.g., 'introductions')
   * @returns {Promise<string>} Channel ID
   */
  async getChannelId(channelName) {
    const result = await getClient().conversations.list();
    const channel = result.channels.find((c) => c.name === channelName);
    if (!channel) {
      throw new Error(`Channel '${channelName}' not found`);
    }
    return channel.id;
  },

  /**
   * Format message for database storage
   * @param {Object} message - Slack message object
   * @param {string} channelId - Channel ID
   * @returns {Object} Formatted message
   */
  formatMessage(message, channelId) {
    return {
      source_type: 'slack',
      source_unique_id: `${channelId}:${message.ts}`,
      content: message.text,
      metadata: {
        user: message.user,
        thread_ts: message.thread_ts,
        reply_count: message.reply_count,
        reactions: message.reactions,
      },
    };
  },

  /**
   * Process a batch of messages and generate embeddings only for new or changed content
   * @param {Array} messages - Array of Slack messages
   * @param {string} channelId - Channel ID
   * @returns {Promise<Array>} Array of formatted messages with embeddings
   */
  async processMessageBatch(messages, channelId) {
    // Format messages
    const formattedMessages = messages.map((msg) => this.formatMessage(msg, channelId));

    // Check which messages need new embeddings
    const messagesNeedingEmbeddings = [];
    const existingMessages = await Promise.all(formattedMessages.map((msg) => getDocBySource(msg.source_unique_id)));

    // Group messages that need embeddings
    for (let i = 0; i < formattedMessages.length; i++) {
      const existing = existingMessages[i];
      if (!existing || existing.content !== formattedMessages[i].content) {
        messagesNeedingEmbeddings.push(formattedMessages[i]);
      }
    }

    // Only generate embeddings for messages that need them
    let embeddings = [];
    if (messagesNeedingEmbeddings.length > 0) {
      console.log(`Generating embeddings for ${messagesNeedingEmbeddings.length} new or changed messages`);
      const texts = messagesNeedingEmbeddings.map((msg) => msg.content);
      embeddings = await generateEmbeddings(texts);
    }

    // Combine messages with their embeddings
    let embeddingIndex = 0;
    return formattedMessages.map((msg, index) => {
      const existing = existingMessages[index];
      if (!existing || existing.content !== msg.content) {
        return {
          ...msg,
          embedding: embeddings[embeddingIndex++],
        };
      }
      return {
        ...msg,
        embedding: existing.embedding,
      };
    });
  },
};

module.exports = { ...slackSync, setTestClient };
