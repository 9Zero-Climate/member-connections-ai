import { mockDatabaseService, mockLoggerService, mockOfficeRndService } from '../../services/mocks'; // These have to be imported before the libraries they are going to mock are imported
import { syncOfficeRnD } from './officernd';

jest.mock('../../services/officernd', () => mockOfficeRndService);
jest.mock('../../services/database', () => mockDatabaseService);
jest.mock('../../services/logger', () => mockLoggerService);

const mockMembersData = [
  {
    id: '1',
    name: 'John Doe',
    slackId: 'U123',
    linkedinUrl: 'https://linkedin.com/in/johndoe',
    location: 'Seattle',
  },
  {
    id: '2',
    name: 'Jane Smith',
    slackId: 'U456',
    linkedinUrl: 'https://linkedin.com/in/janesmith',
    location: 'San Francisco',
  },
];

const VALID_ENV_VARS = {
  DB_URL: 'postgresql://postgres.test',
  OPENAI_API_KEY: 'test-open-api-key',
  OFFICERND_API_URL: 'https://test.officernd.com',
  OFFICERND_ORG_SLUG: 'test-org',
  OFFICERND_CLIENT_ID: 'test-client-id',
  OFFICERND_CLIENT_SECRET: 'test-client-secret',
};

describe('syncOfficeRnD', () => {
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
    mockOfficeRndService.getAllOfficeRnDMembersData.mockResolvedValue(mockMembersData);

    await syncOfficeRnD();

    expect(mockOfficeRndService.getAllOfficeRnDMembersData).toHaveBeenCalledTimes(1);
    expect(mockDatabaseService.bulkUpsertMembers).toHaveBeenCalledTimes(1);

    const expectedMembers = [
      {
        officernd_id: '1',
        name: 'John Doe',
        slack_id: 'U123',
        linkedin_url: 'https://linkedin.com/in/johndoe',
        location: 'Seattle',
      },
      {
        officernd_id: '2',
        name: 'Jane Smith',
        slack_id: 'U456',
        linkedin_url: 'https://linkedin.com/in/janesmith',
        location: 'San Francisco',
      },
    ];
    expect(mockDatabaseService.bulkUpsertMembers).toHaveBeenCalledWith(expectedMembers);
  });

  it('throws on OfficeRnD API errors', async () => {
    mockOfficeRndService.getAllOfficeRnDMembersData.mockRejectedValueOnce(new Error('API Error'));

    await expect(syncOfficeRnD()).rejects.toThrow('API Error');
  });

  it('throws on invalid environment variable configuration', async () => {
    process.env = {};

    await expect(syncOfficeRnD()).rejects.toThrow(/^Missing required environment variables/);
  });

  it('closes db connection even after error', async () => {
    mockOfficeRndService.getAllOfficeRnDMembersData.mockRejectedValueOnce(new Error());

    await expect(syncOfficeRnD()).rejects.toThrow();

    expect(mockDatabaseService.closeDbConnection).toHaveBeenCalledTimes(1);
  });
});
