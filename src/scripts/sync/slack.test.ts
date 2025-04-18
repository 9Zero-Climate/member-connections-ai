// Mock dependencies

import { config } from 'dotenv';
import { mockSlackService, mockDatabaseService, mockLoggerService } from '../../services/mocks'; // These have to be imported before the libraries they are going to mock are imported
import { syncSlackChannels } from './slack';

jest.mock('../../services/slack_sync', () => mockSlackService);
jest.mock('../../services/database', () => mockDatabaseService);
jest.mock('../../services/logger', () => mockLoggerService);

// Load environment variables
config();

const mockMembers = [
  {
    officernd_id: '1',
    name: 'John Doe',
    slack_id: 'U123',
    linkedin_url: 'https://linkedin.com/in/johndoe',
  },
  {
    officernd_id: '2',
    name: 'Jane Smith',
    slack_id: 'U456',
    linkedin_url: 'https://linkedin.com/in/janesmith',
  },
];

const VALID_ENV_VARS = {
  DB_URL: 'postgresql://postgres.test',
  OPENAI_API_KEY: 'test-open-api-key',
  SLACK_BOT_TOKEN: 'test-slack-bot-token',
};

describe('syncSlackChannels', () => {
  // Store original env vars
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = VALID_ENV_VARS;

    jest.clearAllMocks();
  });

  afterAll(() => {
    jest.resetAllMocks();

    // Restore original environment
    process.env = originalEnv;
  });

  it('syncs members successfully', async () => {
    mockSlackService.getChannelId.mockResolvedValue('fake-channel-id');
    mockSlackService.fetchChannelHistory.mockResolvedValue([]);
    mockSlackService.processMessageBatch.mockResolvedValue([]);

    await syncSlackChannels(['fake-channel-name']);

    expect(mockSlackService.getChannelId).toHaveBeenCalledTimes(1);
    expect(mockSlackService.fetchChannelHistory).toHaveBeenCalledTimes(1);

    // TODO: assert something actually useful here about what's happening
  });

  it('throws on Slack API errors', async () => {
    mockSlackService.getChannelId.mockRejectedValueOnce(new Error('API Error'));

    await expect(syncSlackChannels(['fake-channel-name'])).rejects.toThrow('API Error');
  });

  it('throws on invalid environment variable configuration', async () => {
    process.env = {};

    await expect(syncSlackChannels(['fake-channel-name'])).rejects.toThrow(/^Missing required environment variables/);
  });

  it('closes db connection even after error', async () => {
    mockSlackService.getChannelId.mockRejectedValueOnce(new Error());

    await expect(syncSlackChannels(['fake-channel-name'])).rejects.toThrow();

    expect(mockDatabaseService.closeDbConnection).toHaveBeenCalledTimes(1);
  });
});
