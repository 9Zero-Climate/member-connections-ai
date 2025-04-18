// Mock dependencies

import { config } from 'dotenv';
import { mockDatabaseService, mockLoggerService, mockNotionService } from '../../services/mocks'; // These have to be imported before the libraries they are going to mock are imported
import { syncNotion } from './notion';

jest.mock('../../services/notion', () => mockNotionService);
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
  NOTION_API_KEY: 'test-notion-api-key',
  NOTION_MEMBERS_DATABASE_ID: 'test-notion-db-id',
};

describe('syncNotion', () => {
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
    mockNotionService.fetchNotionMembers.mockResolvedValue(mockMembers);

    await syncNotion();

    expect(mockNotionService.fetchNotionMembers).toHaveBeenCalledTimes(1);
    expect(mockDatabaseService.updateMembersFromNotion).toHaveBeenCalledTimes(1);
    expect(mockDatabaseService.updateMembersFromNotion).toHaveBeenCalledWith(mockMembers);
  });

  it('throws on Notion API errors', async () => {
    mockNotionService.fetchNotionMembers.mockRejectedValueOnce(new Error('API Error'));

    await expect(syncNotion()).rejects.toThrow('API Error');
  });

  it('throws on invalid environment variable configuration', async () => {
    process.env = {};

    await expect(syncNotion()).rejects.toThrow(/^Missing required environment variables/);
  });

  it('closes db connection even after error', async () => {
    mockNotionService.fetchNotionMembers.mockRejectedValueOnce(new Error());

    await expect(syncNotion()).rejects.toThrow();

    expect(mockDatabaseService.closeDbConnection).toHaveBeenCalledTimes(1);
  });
});
