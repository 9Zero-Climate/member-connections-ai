import { WebClient } from '@slack/web-api';
import { addFeedbackHintReactions, fetchSlackThread, fetchUserInfo } from './slackInteraction';

// --- Mock Implementations ---
const mockReplies = jest.fn();
const mockInfo = jest.fn();
const mockReactionsAdd = jest.fn();

// --- Mock Factories ---
jest.mock('@slack/web-api', () => ({
  WebClient: jest.fn().mockImplementation(() => ({
    conversations: { replies: mockReplies },
    users: { info: mockInfo },
    reactions: { add: mockReactionsAdd },
  })),
}));

// Get mock instances type safely
const MockedWebClient = WebClient as jest.MockedClass<typeof WebClient>;

describe('slackInteraction', () => {
  let mockClientInstance: jest.Mocked<WebClient>;

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    mockReplies.mockClear();
    mockInfo.mockClear();
    mockReactionsAdd.mockClear();

    // Instantiate the client using the mocked constructor
    mockClientInstance = new MockedWebClient() as jest.Mocked<WebClient>;
  });

  describe('fetchSlackThread', () => {
    it('should return empty array if thread_ts is undefined', async () => {
      const messages = await fetchSlackThread(mockClientInstance, 'C123', undefined);
      expect(messages).toEqual([]);
      expect(mockReplies).not.toHaveBeenCalled();
    });

    it('should call conversations.replies and return messages if thread_ts is provided', async () => {
      const mockMessages = [{ ts: '123', text: 'Reply 1' }];
      mockReplies.mockResolvedValue({
        ok: true,
        messages: mockMessages,
      });
      const messages = await fetchSlackThread(mockClientInstance, 'C123', 'ts1');
      expect(messages).toEqual(mockMessages);
      expect(mockReplies).toHaveBeenCalledWith({
        channel: 'C123',
        ts: 'ts1',
        include_all_metadata: true,
      });
    });

    it('should throw error if conversations.replies fails', async () => {
      mockReplies.mockResolvedValue({
        ok: false,
        error: 'fetch_failed',
      });
      await expect(fetchSlackThread(mockClientInstance, 'C123', 'ts1')).rejects.toThrow(
        'Failed to fetch thread replies: fetch_failed',
      );
      expect(mockReplies).toHaveBeenCalledWith({
        channel: 'C123',
        ts: 'ts1',
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
});
