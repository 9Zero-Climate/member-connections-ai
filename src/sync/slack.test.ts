import type { Document } from '../services/database';
import { mockDatabaseService, mockLoggerService, mockSlackService } from '../services/mocks'; // These have to be imported before the libraries they are going to mock are imported
import { doesSlackMessageMatchDb, syncSlackChannels, upsertSlackMessagesRagDocs } from './slack';

jest.mock('../services/slack_sync', () => mockSlackService);
jest.mock('../services/database', () => mockDatabaseService);
jest.mock('../services/logger', () => mockLoggerService);

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
    mockSlackService.processMessages.mockResolvedValue([]);

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

describe('upsertSlackMessagesRagDocs', () => {
  const mockChannelName = 'Channel Name';
  const mockChannelId = 'channel-id';
  const mockFormattedMessage = {
    ts: 'timestamp',
    text: 'text',
    permalink: 'permalink',
  };
  const mockMatchingDoc = {
    source_type: 'slack',
    source_unique_id: 'channel-id:timestamp',
    content: 'text',
    metadata: {
      ts: 'timestamp',
      channelId: mockChannelId,
      channelName: mockChannelName,
      permalink: 'permalink',
    },
  };

  it('skips upsert if unchanged', async () => {
    mockDatabaseService.getDocBySource.mockResolvedValue(mockMatchingDoc);

    await upsertSlackMessagesRagDocs([mockFormattedMessage], mockChannelName, mockChannelId);

    expect(mockDatabaseService.insertOrUpdateDoc).not.toHaveBeenCalled();
  });

  it('upserts if no existing doc', async () => {
    mockDatabaseService.getDocBySource.mockResolvedValue(null);
    await upsertSlackMessagesRagDocs([mockFormattedMessage], mockChannelName, mockChannelId);

    expect(mockDatabaseService.insertOrUpdateDoc).toHaveBeenCalled();
  });

  it('upserts if existing doc does not match', async () => {
    mockDatabaseService.getDocBySource.mockResolvedValue({ ...mockMatchingDoc, content: 'different text' });
    await upsertSlackMessagesRagDocs([mockFormattedMessage], mockChannelName, mockChannelId);

    expect(mockDatabaseService.insertOrUpdateDoc).toHaveBeenCalled();
  });
});

describe('doesSlackMessageMatchDb', () => {
  const baseDoc: Document = {
    source_type: 'slack',
    source_unique_id: 'test:123',
    content: 'Hello world',
    embedding: null,
    metadata: {
      slack_user_id: 'U123',
      channel: 'C123',
      channel_name: 'general',
    },
  };

  it('returns true for identical documents', () => {
    const doc1 = { ...baseDoc };
    const doc2 = { ...baseDoc };
    expect(doesSlackMessageMatchDb(doc1, doc2)).toBe(true);
  });

  it('returns false for different content', () => {
    const doc1 = { ...baseDoc };
    const doc2 = { ...baseDoc, content: 'Different content' };
    expect(doesSlackMessageMatchDb(doc1, doc2)).toBe(false);
  });

  it('ignores undefined/null metadata fields', () => {
    const doc1 = {
      ...baseDoc,
      metadata: {
        ...baseDoc.metadata,
        thread_ts: undefined,
        reply_count: undefined,
      },
    };
    const doc2 = {
      ...baseDoc,
      metadata: {
        ...baseDoc.metadata,
        // These fields are missing entirely
      },
    };
    expect(doesSlackMessageMatchDb(doc1, doc2)).toBe(true);
  });

  it('handles missing metadata', () => {
    const doc1 = { ...baseDoc, metadata: undefined };
    const doc2 = { ...baseDoc, metadata: {} };
    expect(doesSlackMessageMatchDb(doc1, doc2)).toBe(true);
  });

  it('ignores database-specific fields', () => {
    const doc1 = {
      ...baseDoc,
      created_at: new Date('2024-03-14'),
      updated_at: new Date('2024-03-14'),
    };
    const doc2 = { ...baseDoc };
    expect(doesSlackMessageMatchDb(doc1, doc2)).toBe(true);
  });

  it('ignores embedding differences', () => {
    const doc1 = { ...baseDoc, embedding: [1, 2, 3] };
    const doc2 = { ...baseDoc, embedding: [4, 5, 6] };
    expect(doesSlackMessageMatchDb(doc1, doc2)).toBe(true);
  });

  it('detects meaningful metadata differences', () => {
    const doc1 = {
      ...baseDoc,
      metadata: {
        ...baseDoc.metadata,
        reactions: [{ name: 'thumbsup', count: 1 }],
      },
    };
    const doc2 = {
      ...baseDoc,
      metadata: {
        ...baseDoc.metadata,
        reactions: [{ name: 'thumbsdown', count: 1 }],
      },
    };
    expect(doesSlackMessageMatchDb(doc1, doc2)).toBe(false);
  });
});
