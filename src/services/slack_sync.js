const { WebClient } = require('@slack/web-api');
const { config } = require('dotenv');

config();

const client = new WebClient(process.env.SLACK_BOT_TOKEN);

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
            await client.conversations.join({ channel: channelId });
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
            const result = await client.conversations.history({
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
        const result = await client.conversations.list();
        const channel = result.channels.find(c => c.name === channelName);
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
};

module.exports = slackSync; 