import { config } from 'dotenv';
import { mockDatabaseService, mockLoggerService, mockProxycurlService } from '../../services/mocks'; // These have to be imported before the libraries they are going to mock are imported
import { getMembersToUpdate, syncLinkedIn } from './linkedin';

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

const mockMembers = [
  {
    id: '1',
    name: 'John Doe',
    last_linkedin_update: 1717334400000,
    linkedin_url: 'https://linkedin.com/in/johndoe',
  },
  {
    id: '2',
    name: 'Jane Smith',
    last_linkedin_update: 1717334400000,
    linkedin_url: 'https://linkedin.com/in/janesmith',
  },
];

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

    mockDatabaseService.getMembersWithLastLinkedInUpdates.mockResolvedValue(mockMembers);
    mockProxycurlService.getLinkedInProfile.mockResolvedValue(mockLinkedInProfile);
  });

  afterAll(() => {
    jest.resetAllMocks();

    // Restore original environment
    process.env = originalEnv;
  });

  it('syncs members successfully', async () => {
    await syncLinkedIn();

    expect(mockDatabaseService.getMembersWithLastLinkedInUpdates).toHaveBeenCalledTimes(1);

    // Expect each of these two be called once per member
    expect(mockProxycurlService.getLinkedInProfile).toHaveBeenCalledTimes(2);
    expect(mockProxycurlService.createLinkedInDocuments).toHaveBeenCalledTimes(2);
  });

  it('throws on Proxycurl API errors', async () => {
    mockDatabaseService.getMembersWithLastLinkedInUpdates.mockResolvedValue(mockMembers);
    mockProxycurlService.getLinkedInProfile.mockRejectedValueOnce(new Error('API Error'));

    await expect(syncLinkedIn()).rejects.toThrow('API Error');
  });

  it('throws on invalid environment variable configuration', async () => {
    mockDatabaseService.getMembersWithLastLinkedInUpdates.mockResolvedValue(mockMembers);
    process.env = {};

    await expect(syncLinkedIn()).rejects.toThrow(/^Missing required environment variables/);
  });

  it('closes db connection even after error', async () => {
    mockDatabaseService.getMembersWithLastLinkedInUpdates.mockResolvedValue(mockMembers);
    mockProxycurlService.getLinkedInProfile.mockRejectedValueOnce(new Error());

    await expect(syncLinkedIn()).rejects.toThrow();

    expect(mockDatabaseService.closeDbConnection).toHaveBeenCalledTimes(1);
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
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(memberWithNoLinkedInData); // New user should be first
    expect(result[1]).toBe(memberWithOldLinkedInData); // Old user should be second
  });

  it('should not include recently updated members', () => {
    const members = [memberWithNoLinkedInData, memberWithRecentLinkedInData, memberWithOldLinkedInData];

    const result = getMembersToUpdate(members);
    expect(result).toHaveLength(2);
    expect(result).toEqual([memberWithNoLinkedInData, memberWithOldLinkedInData]); // Should only include new and old users
  });

  it('should respect maxUpdates limit', () => {
    const members = Array.from({ length: 150 }, (_, i) => ({
      id: String(i),
      name: `User ${i}`,
      linkedin_url: `https://linkedin.com/in/user${i}`,
      metadata: { last_linkedin_update: twoMonthsAgo },
    }));

    const result = getMembersToUpdate(members);
    expect(result).toHaveLength(100); // Should be limited to 100
  });

  it('should handle custom maxUpdates parameter', () => {
    const members = Array.from({ length: 50 }, (_, i) => ({
      id: String(i),
      name: `User ${i}`,
      linkedin_url: `https://linkedin.com/in/user${i}`,
      metadata: { last_linkedin_update: twoMonthsAgo },
    }));

    const result = getMembersToUpdate(members, 10);
    expect(result).toHaveLength(10); // Should respect custom limit
  });
});
