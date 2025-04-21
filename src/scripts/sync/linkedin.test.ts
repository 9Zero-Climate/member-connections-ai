import { config } from 'dotenv';
import { mockDatabaseService, mockLoggerService, mockProxycurlService } from '../../services/mocks'; // These have to be imported before the libraries they are going to mock are imported
import { getMembersToUpdate, getValidSyncOptions, LinkedInSyncOptions, syncLinkedIn } from './linkedin';

// Load environment variables
config();

jest.mock('../../services/proxycurl', () => mockProxycurlService);
jest.mock('../../services/database', () => mockDatabaseService);
jest.mock('../../services/logger', () => mockLoggerService);

const VALID_ENV_VARS = {
  DB_URL: 'postgresql://postgres.test',
  OPENAI_API_KEY: 'test-open-api-key',
  PROXYCURL_API_KEY: 'test-proxycurl-api-key',
};

const createMockMembers = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: String(i),
    name: `User ${i}`,
    linkedin_url: `https://linkedin.com/in/user${i}`,
    metadata: { last_linkedin_update: Date.now() },
  }));

const mockLinkedInProfile = {
  headline: 'Software Engineer',
  summary: 'Experienced developer',
  experiences: [
    {
      title: 'Software Engineer',
      company: '9Zero',
      description: 'Led development',
      date_range: '2020-2024',
      location: 'San Francisco',
    },
  ],
  education: [
    {
      school: 'Stanford',
      degree_name: 'BS',
      field_of_study: 'Computer Science',
      date_range: '2016-2020',
      description: 'Focus on AI',
    },
  ],
  skills: ['Python', 'TypeScript'],
  languages: ['English'],
};

describe('syncLinkedIn', () => {
  // Store original env vars
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = VALID_ENV_VARS;

    jest.clearAllMocks();

    const mockMembers = createMockMembers(10);
    mockDatabaseService.getMembersWithLastLinkedInUpdates.mockResolvedValue(mockMembers);
    mockProxycurlService.getLinkedInProfile.mockResolvedValue(mockLinkedInProfile);
  });

  afterAll(() => {
    jest.resetAllMocks();

    // Restore original environment
    process.env = originalEnv;
  });

  it('syncs members successfully', async () => {
    mockDatabaseService.getMembersWithLastLinkedInUpdates.mockResolvedValue(createMockMembers(10));

    await syncLinkedIn();

    expect(mockDatabaseService.getMembersWithLastLinkedInUpdates).toHaveBeenCalledTimes(1);

    // Expect each of these two be called once per member
    expect(mockProxycurlService.getLinkedInProfile).toHaveBeenCalledTimes(10);
    expect(mockProxycurlService.createLinkedInDocuments).toHaveBeenCalledTimes(10);
  });

  it('respects default maxUpdates', async () => {
    mockDatabaseService.getMembersWithLastLinkedInUpdates.mockResolvedValue(createMockMembers(150));

    await syncLinkedIn();

    // Should limit to default # calls (100)
    expect(mockProxycurlService.getLinkedInProfile).toHaveBeenCalledTimes(100);
  });

  it('respects custom maxUpdates', async () => {
    mockDatabaseService.getMembersWithLastLinkedInUpdates.mockResolvedValue(createMockMembers(150));

    await syncLinkedIn({ maxUpdates: 125 });

    // Should return as many as requested
    expect(mockProxycurlService.getLinkedInProfile).toHaveBeenCalledTimes(125);
  });

  it('throws on invalid sync options', async () => {
    await expect(syncLinkedIn({ maxUpdates: Number.NaN })).rejects.toThrow();
  });

  it('throws on Proxycurl API errors', async () => {
    mockProxycurlService.getLinkedInProfile.mockRejectedValueOnce(new Error('API Error'));

    await expect(syncLinkedIn()).rejects.toThrow('API Error');
  });

  it('throws on invalid environment variable configuration', async () => {
    process.env = {};

    await expect(syncLinkedIn()).rejects.toThrow(/^Missing required environment variables/);
  });

  it('closes db connection even after error', async () => {
    mockProxycurlService.getLinkedInProfile.mockRejectedValueOnce(new Error());

    await expect(syncLinkedIn()).rejects.toThrow();

    expect(mockDatabaseService.closeDbConnection).toHaveBeenCalledTimes(1);
  });
});

describe('getValidSyncOptions', () => {
  it.each([
    ['undefined', undefined, { maxUpdates: 100, allowedAgeDays: 7 }],
    ['empty object', {}, { maxUpdates: 100, allowedAgeDays: 7 }],
    ['both undefined', { maxUpdates: undefined, allowedAgeDays: undefined }, { maxUpdates: 100, allowedAgeDays: 7 }],
    ['allowedAgeDays undefined', { maxUpdates: 1, allowedAgeDays: undefined }, { maxUpdates: 1, allowedAgeDays: 7 }],
    ['maxUpdates undefined', { maxUpdates: undefined, allowedAgeDays: 1 }, { maxUpdates: 100, allowedAgeDays: 1 }],
    ['both provided', { maxUpdates: 1, allowedAgeDays: 1 }, { maxUpdates: 1, allowedAgeDays: 1 }],
  ])('falls back to default sync options as appropriate (%s)', (_testName, syncOptionOverrides, expected) => {
    const result = getValidSyncOptions(syncOptionOverrides);
    expect(result).toEqual(expected);
  });

  it.each([['not a number'], [Number.NaN], [null]])('throws on invalid sync options (%s)', async (invalidOption) => {
    expect(() => getValidSyncOptions({ maxUpdates: 1, allowedAgeDays: invalidOption })).toThrow();
    expect(() => getValidSyncOptions({ maxUpdates: invalidOption, allowedAgeDays: 1 })).toThrow();
    expect(() => getValidSyncOptions({ maxUpdates: invalidOption, allowedAgeDays: invalidOption })).toThrow();
  });
});

describe('getMembersToUpdate', () => {
  const now = Date.now();
  const twoMonthsAgo = now - 60 * 24 * 60 * 60 * 1000;
  const memberWithNoLinkedInData = { id: '1', name: 'Alice', linkedin_url: 'https://linkedin.com/in/Alice' };
  const memberWithRecentLinkedInData = {
    id: '2',
    name: 'Bob',
    linkedin_url: 'https://linkedin.com/in/Bob',
    last_linkedin_update: now - 1000,
  };
  const memberWithOldLinkedInData = {
    id: '3',
    name: 'Charlie',
    linkedin_url: 'https://linkedin.com/in/Charlie',
    last_linkedin_update: twoMonthsAgo,
  };
  const memberWithNoLinkedInUrl = {
    id: '4',
    name: 'David',
    linkedin_url: null,
  };

  it('should filter out members without LinkedIn url', () => {
    const members = [memberWithNoLinkedInData, memberWithNoLinkedInUrl];

    const result = getMembersToUpdate(members);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(memberWithNoLinkedInData);
  });

  it('should prioritize members without LinkedIn data', () => {
    const members = [memberWithOldLinkedInData, memberWithNoLinkedInData];

    const result = getMembersToUpdate(members);

    expect(result).toEqual([
      memberWithNoLinkedInData, // New user should be first
      memberWithOldLinkedInData, // Old user should be second
    ]);
  });

  it('should not include recently updated members', () => {
    const members = [memberWithNoLinkedInData, memberWithRecentLinkedInData, memberWithOldLinkedInData];

    const result = getMembersToUpdate(members);

    // Should only include new and old users, skipping member with recent data
    expect(result).toEqual([memberWithNoLinkedInData, memberWithOldLinkedInData]);
  });

  it('should respect maxUpdates limit', () => {
    const members = createMockMembers(150);

    const result = getMembersToUpdate(members);

    // Should be limited to 100, the default maxUpdates setting
    expect(result).toHaveLength(100);
  });

  it('should handle custom maxUpdates parameter', () => {
    const members = createMockMembers(50);

    const result = getMembersToUpdate(members, 10);

    // Should respect custom maxUpdates limit
    expect(result).toHaveLength(10);
  });
});
