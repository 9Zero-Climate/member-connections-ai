const { WebClient } = require('@slack/web-api');
const { generateEmbeddings } = require('./embedding');

// Mock dependencies
jest.mock('@slack/web-api');
jest.mock('./embedding', () => ({
  ...jest.requireActual('./embedding'),
  generateEmbeddings: jest.fn(),
}));

const { setTestClient, ...slackSync } = require('./slack_sync');

describe('slackSync', () => {
  const mockChannelId = 'C1234567890';
  const mockMessages = [
    {
      ts: '1234567890.123456',
      text: 'Hello world',
      user: 'U1234567890',
      thread_ts: '1234567890.123457',
      reply_count: 2,
      reactions: [{ name: 'thumbsup', count: 1 }],
    },
    {
      ts: '1234567890.123458',
      text: 'Another message',
      user: 'U0987654321',
      thread_ts: '1234567890.123459',
      reply_count: 1,
      reactions: [{ name: 'heart', count: 1 }],
    },
  ];

  let mockClient;
  let mockConversations;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock client
    mockConversations = {
      history: jest.fn(),
      list: jest.fn(),
      join: jest.fn(),
    };
    mockClient = {
      conversations: mockConversations,
    };
    setTestClient(mockClient);

    // Setup mock embeddings
    generateEmbeddings.mockResolvedValue([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);
  });

  describe('joinChannel', () => {
    it('should join a channel', async () => {
      mockConversations.join.mockResolvedValueOnce({ ok: true });

      await slackSync.joinChannel(mockChannelId);

      expect(mockConversations.join).toHaveBeenCalledWith({
        channel: mockChannelId,
      });
    });

    it('should handle already_in_channel error gracefully', async () => {
      mockConversations.join.mockRejectedValueOnce({
        data: { error: 'already_in_channel' },
      });

      await expect(slackSync.joinChannel(mockChannelId)).resolves.not.toThrow();
    });

    it('should throw other errors', async () => {
      mockConversations.join.mockRejectedValueOnce(new Error('Other error'));

      await expect(slackSync.joinChannel(mockChannelId)).rejects.toThrow('Other error');
    });
  });

  describe('fetchChannelHistory', () => {
    it('should fetch messages from a channel', async () => {
      mockConversations.join.mockResolvedValueOnce({ ok: true });
      mockConversations.history.mockResolvedValueOnce({
        ok: true,
        messages: mockMessages,
        response_metadata: { next_cursor: null },
      });

      const messages = await slackSync.fetchChannelHistory(mockChannelId);

      expect(mockConversations.join).toHaveBeenCalledWith({
        channel: mockChannelId,
      });
      expect(mockConversations.history).toHaveBeenCalledWith({
        channel: mockChannelId,
        limit: 100,
        cursor: undefined,
        oldest: undefined,
        latest: undefined,
      });
      expect(messages).toEqual(mockMessages);
    });

    it('should handle pagination', async () => {
      mockConversations.join.mockResolvedValueOnce({ ok: true });
      const firstPage = {
        ok: true,
        messages: mockMessages,
        response_metadata: { next_cursor: 'next_page' },
      };
      const secondPage = {
        ok: true,
        messages: [{ ...mockMessages[0], text: 'Second page' }],
        response_metadata: { next_cursor: null },
      };

      mockConversations.history.mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage);

      const messages = await slackSync.fetchChannelHistory(mockChannelId);

      expect(mockConversations.join).toHaveBeenCalledWith({
        channel: mockChannelId,
      });
      expect(mockConversations.history).toHaveBeenCalledTimes(2);
      expect(messages).toHaveLength(3);
    });

    it('should respect the limit parameter', async () => {
      mockConversations.join.mockResolvedValueOnce({ ok: true });
      mockConversations.history.mockResolvedValueOnce({
        ok: true,
        messages: mockMessages,
        response_metadata: { next_cursor: 'next_page' },
      });

      await slackSync.fetchChannelHistory(mockChannelId, { limit: 1 });

      expect(mockConversations.join).toHaveBeenCalledWith({
        channel: mockChannelId,
      });
      expect(mockConversations.history).toHaveBeenCalledWith({
        channel: mockChannelId,
        limit: 1,
        cursor: undefined,
        oldest: undefined,
        latest: undefined,
      });
    });
  });

  describe('getChannelId', () => {
    it('should return channel ID for valid channel name', async () => {
      mockConversations.list.mockResolvedValueOnce({
        ok: true,
        channels: [
          { id: mockChannelId, name: 'introductions' },
          { id: 'C0987654321', name: 'general' },
        ],
      });

      const channelId = await slackSync.getChannelId('introductions');

      expect(mockConversations.list).toHaveBeenCalled();
      expect(channelId).toBe(mockChannelId);
    });

    it('should throw error for invalid channel name', async () => {
      mockConversations.list.mockResolvedValueOnce({
        ok: true,
        channels: [{ id: 'C0987654321', name: 'general' }],
      });

      await expect(slackSync.getChannelId('nonexistent')).rejects.toThrow("Channel 'nonexistent' not found");
    });
  });

  describe('formatMessage', () => {
    it('should format message correctly', () => {
      const formatted = slackSync.formatMessage(mockMessages[0], mockChannelId);

      expect(formatted).toEqual({
        source_type: 'slack',
        source_unique_id: `${mockChannelId}:${mockMessages[0].ts}`,
        content: mockMessages[0].text,
        metadata: {
          user: mockMessages[0].user,
          thread_ts: mockMessages[0].thread_ts,
          reply_count: mockMessages[0].reply_count,
          reactions: mockMessages[0].reactions,
        },
      });
    });
  });

  describe('processMessageBatch', () => {
    it('should process messages and generate embeddings', async () => {
      const processed = await slackSync.processMessageBatch(mockMessages, mockChannelId);

      expect(generateEmbeddings).toHaveBeenCalledWith([mockMessages[0].text, mockMessages[1].text]);
      expect(processed).toHaveLength(2);
      expect(processed[0]).toEqual({
        source_type: 'slack',
        source_unique_id: `${mockChannelId}:${mockMessages[0].ts}`,
        content: mockMessages[0].text,
        metadata: {
          user: mockMessages[0].user,
          thread_ts: mockMessages[0].thread_ts,
          reply_count: mockMessages[0].reply_count,
          reactions: mockMessages[0].reactions,
        },
        embedding: [0.1, 0.2, 0.3],
      });
    });

    it('should handle embedding generation errors', async () => {
      generateEmbeddings.mockRejectedValueOnce(new Error('API error'));

      await expect(slackSync.processMessageBatch(mockMessages, mockChannelId)).rejects.toThrow('API error');
    });
  });
});
