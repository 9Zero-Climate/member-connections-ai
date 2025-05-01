import { WebClient } from '@slack/web-api';
import {
  addFeedbackHintReactions,
  fetchSlackChannelMessages,
  fetchSlackThreadAndChannelContext,
  fetchSlackThreadMessages,
  fetchUserInfo,
} from './slackInteraction';

// --- Mock Implementations ---
const mockReplies = jest.fn();
const mockHistory = jest.fn();
const mockInfo = jest.fn();
const mockReactionsAdd = jest.fn();

// --- Mock Factories ---
jest.mock('@slack/web-api', () => ({
  WebClient: jest.fn().mockImplementation(() => ({
    conversations: { replies: mockReplies, history: mockHistory },
    users: { info: mockInfo },
    reactions: { add: mockReactionsAdd },
  })),
}));

// Get mock instances type safely
const MockedWebClient = WebClient as jest.MockedClass<typeof WebClient>;

describe('slackInteraction', () => {
  let mockClientInstance: jest.Mocked<WebClient>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Instantiate the client using the mocked constructor
    mockClientInstance = new MockedWebClient() as jest.Mocked<WebClient>;
  });

  describe('fetchSlackThreadMessages', () => {
    it('should call conversations.replies and return messages if thread_ts is provided', async () => {
      const mockMessages = [{ ts: '123', text: 'Reply 1' }];
      mockReplies.mockResolvedValue({
        ok: true,
        messages: mockMessages,
      });
      const messages = await fetchSlackThreadMessages(mockClientInstance, 'C123', 'ts1');
      expect(messages).toEqual(mockMessages);
      expect(mockReplies).toHaveBeenCalledWith({
        channel: 'C123',
        ts: 'ts1',
        include_all_metadata: true,
        limit: 999,
      });
    });
  });

  describe('fetchChannelMessages', () => {
    it('should call conversations.history and return messages', async () => {
      const mockMessages = [{ ts: '123', text: 'Reply 1' }];
      mockHistory.mockResolvedValue({
        ok: true,
        messages: mockMessages,
      });
      const messages = await fetchSlackChannelMessages(mockClientInstance, 'C123');
      expect(messages).toEqual(mockMessages);
      expect(mockHistory).toHaveBeenCalledWith({
        channel: 'C123',
        limit: 999,
        include_all_metadata: true,
      });
    });
  });

  describe('fetchUserInfo', () => {
    it('should call users.info and return formatted user info on success', async () => {
      const mockUserResponse = {
        ok: true,
        user: {
          id: 'U123',
          tz: 'America/New_York',
          tz_offset: -14400,
          profile: {
            real_name: 'Test User',
            display_name: 'tester',
            real_name_normalized: 'test user',
          },
        },
      };
      mockInfo.mockResolvedValue(mockUserResponse);
      const userInfo = await fetchUserInfo(mockClientInstance, 'U123');
      expect(userInfo).toEqual({
        slack_ID: '<@U123>',
        preferred_name: 'tester',
        real_name: 'Test User',
        time_zone: 'America/New_York',
        time_zone_offset: -14400,
      });
      expect(mockInfo).toHaveBeenCalledWith({ user: 'U123' });
    });

    it('should throw error if users.info returns ok: false', async () => {
      mockInfo.mockResolvedValue({ ok: false, error: 'user_not_found' });
      await expect(fetchUserInfo(mockClientInstance, 'U123')).rejects.toThrow(
        'Failed to fetch user info for U123: user_not_found',
      );
      expect(mockInfo).toHaveBeenCalledWith({ user: 'U123' });
    });
  });

  describe('addFeedbackHintReactions', () => {
    it('should add feedback reactions to message', async () => {
      await addFeedbackHintReactions(mockClientInstance, 'C123', 'ts123');
      expect(mockReactionsAdd).toHaveBeenCalledTimes(2);
      expect(mockReactionsAdd).toHaveBeenCalledWith({
        name: '+1',
        channel: 'C123',
        timestamp: 'ts123',
      });
      expect(mockReactionsAdd).toHaveBeenCalledWith({
        name: '-1',
        channel: 'C123',
        timestamp: 'ts123',
      });
    });
  });

  describe('fetchSlackThreadAndChannelContext', () => {
    it('fetches and combines thread and channel messages with correct limits', async () => {
      // Create test data with timestamps
      const threadTs = '1234567890.123456';
      const oneDayAgo = '1234481490.123456'; // threadTs - 24*60*60

      const threadMessages = [
        { ts: '1234567890.000001', text: 'Thread message 1' },
        { ts: '1234567890.000002', text: 'Thread message 2' },
      ];

      const channelMessages = Array.from({ length: 15 }, (_, i) => ({
        ts: `1234567889.00000${i}`,
        text: `Channel message ${i + 1}`,
      }));

      // Mock the API responses
      mockReplies.mockResolvedValue({
        ok: true,
        messages: threadMessages,
      });

      mockHistory.mockResolvedValue({
        ok: true,
        messages: channelMessages,
      });

      const result = await fetchSlackThreadAndChannelContext(mockClientInstance, 'C123', threadTs);

      // Verify the result
      expect(result).toBeDefined();
      if (!result) {
        throw new Error('Expected result to be defined');
      }
      expect(result.length).toBeLessThanOrEqual(100); // Total messages limit

      // Verify channel messages are limited
      const channelMessagesInResult = result.filter((msg) => !threadMessages.find((tm) => tm.ts === msg.ts));
      expect(channelMessagesInResult.length).toBeLessThanOrEqual(10); // Max channel messages

      // Verify API calls
      expect(mockReplies).toHaveBeenCalledWith({
        channel: 'C123',
        ts: threadTs,
        include_all_metadata: true,
        limit: 999,
      });

      expect(mockHistory).toHaveBeenCalledWith({
        channel: 'C123',
        include_all_metadata: true,
        limit: 999,
        oldest: oneDayAgo,
        latest: threadTs,
        inclusive: false,
      });
    });

    it('handles empty channel messages gracefully', async () => {
      const threadTs = '1234567890.123456';
      const threadMessages = [{ ts: '1234567890.000001', text: 'Thread message 1' }];

      mockReplies.mockResolvedValue({
        ok: true,
        messages: threadMessages,
      });

      mockHistory.mockResolvedValue({
        ok: true,
        messages: [],
      });

      const result = await fetchSlackThreadAndChannelContext(mockClientInstance, 'C123', threadTs);

      expect(result).toEqual(threadMessages);
    });

    it('handles empty thread messages gracefully', async () => {
      const threadTs = '1234567890.123456';
      const channelMessages = [{ ts: '1234567889.000001', text: 'Channel message 1' }];

      mockReplies.mockResolvedValue({
        ok: true,
        messages: [],
      });

      mockHistory.mockResolvedValue({
        ok: true,
        messages: channelMessages,
      });

      const result = await fetchSlackThreadAndChannelContext(mockClientInstance, 'C123', threadTs);

      expect(result).toEqual(channelMessages.slice(-10));
    });
  });
});
