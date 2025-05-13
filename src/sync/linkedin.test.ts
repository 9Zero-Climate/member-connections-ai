import { mockDatabaseService, mockLoggerService, mockProxycurlService } from '../services/mocks'; // These have to be imported before the libraries they are going to mock are imported
import {
  MILLISECONDS_PER_DAY,
  createLinkedInDocuments,
  getMembersToUpdate,
  getValidSyncOptions,
  needsLinkedInUpdate,
  syncLinkedIn,
  updateLinkedinForMemberIfNeeded,
} from './linkedin';
import { DEFAULT_LINKEDIN_PROFLE_ALLOWED_AGE_DAYS } from './linkedin_constants';

jest.mock('../services/proxycurl', () => mockProxycurlService);
jest.mock('../services/database', () => mockDatabaseService);
jest.mock('../services/logger', () => mockLoggerService);

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
    expect(mockDatabaseService.deleteTypedDocumentsForMember).toHaveBeenCalledTimes(10);
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
    ['respects 0', { maxUpdates: 0, allowedAgeDays: 1 }, { maxUpdates: 0, allowedAgeDays: 1 }],
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

describe('createLinkedInDocuments', () => {
  const mockProfile = {
    headline: 'Software Engineer',
    summary: 'Experienced developer',
    experiences: [
      {
        title: 'Software Engineer',
        company: '9Zero',
        description: 'Led development',
        starts_at: {
          day: 1,
          month: 1,
          year: 2020,
        },
        ends_at: {
          day: 31,
          month: 12,
          year: 2024,
        },
        location: 'San Francisco',
      },
    ],
    education: [
      {
        school: 'Stanford',
        degree_name: 'BS',
        field_of_study: 'Computer Science',
        starts_at: {
          day: 1,
          month: 9,
          year: 2016,
        },
        ends_at: {
          day: 30,
          month: 6,
          year: 2020,
        },
        description: 'Focus on AI',
      },
    ],
    skills: ['Python', 'TypeScript'],
    languages: ['English'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create all document types', async () => {
    await createLinkedInDocuments('123', 'John Doe', 'https://linkedin.com/in/johndoe', mockProfile);

    // Verify document creation
    expect(mockDatabaseService.insertOrUpdateDoc).toHaveBeenCalledTimes(6); // headline, summary, experience, education, skills, languages

    // Verify headline document
    expect(mockDatabaseService.insertOrUpdateDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        source_type: 'linkedin_headline',
        source_unique_id: 'officernd_member_123:headline',
        content: 'Software Engineer',
        embedding: null,
        metadata: expect.objectContaining({
          member_name: 'John Doe',
          linkedin_url: 'https://linkedin.com/in/johndoe',
        }),
      }),
    );

    // Verify experience document
    expect(mockDatabaseService.insertOrUpdateDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        source_type: 'linkedin_experience',
        source_unique_id: expect.stringContaining('officernd_member_123:experience_9zero-2020-01-01-2024-12-31'),
        content: expect.stringContaining('Software Engineer at 9Zero'),
        embedding: null,
        metadata: expect.objectContaining({
          member_name: 'John Doe',
          linkedin_url: 'https://linkedin.com/in/johndoe',
          title: 'Software Engineer',
          company: '9Zero',
          date_range: '2020-01-01 - 2024-12-31',
          location: 'San Francisco',
        }),
      }),
    );

    // Verify education document
    expect(mockDatabaseService.insertOrUpdateDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        source_type: 'linkedin_education',
        source_unique_id: expect.stringContaining('officernd_member_123:education_stanford-2016-09-01-2020-06-30'),
        content: expect.stringContaining('Stanford'),
        embedding: null,
        metadata: expect.objectContaining({
          member_name: 'John Doe',
          linkedin_url: 'https://linkedin.com/in/johndoe',
          school: 'Stanford',
          degree_name: 'BS',
          field_of_study: 'Computer Science',
          date_range: '2016-09-01 - 2020-06-30',
        }),
      }),
    );
  });

  it('should handle missing optional fields', async () => {
    const profileWithMissingFields = {
      ...mockProfile,
      headline: null,
      summary: null,
      experiences: [],
      education: [],
      skills: [],
      languages: [],
    };

    await createLinkedInDocuments('123', 'John Doe', 'https://linkedin.com/in/johndoe', profileWithMissingFields);

    // Verify no documents were created
    expect(mockDatabaseService.insertOrUpdateDoc).not.toHaveBeenCalled();
  });

  it('should handle experiences with missing fields', async () => {
    const profileWithMissingExperienceFields = {
      ...mockProfile,
      experiences: [
        {
          title: null,
          company: '9Zero',
          description: null,
          starts_at: null,
          ends_at: null,
          location: null,
        },
      ],
    };

    await createLinkedInDocuments(
      '123',
      'John Doe',
      'https://linkedin.com/in/johndoe',
      profileWithMissingExperienceFields,
    );

    // Verify experience document was created with null fields
    expect(mockDatabaseService.insertOrUpdateDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        source_type: 'linkedin_experience',
        source_unique_id: expect.stringContaining('officernd_member_123:experience_9zero-9zero'),
        content: '9Zero',
        metadata: expect.objectContaining({
          title: null,
          company: '9Zero',
          date_range: null,
          location: null,
        }),
      }),
    );
  });

  it('should handle education with missing fields', async () => {
    const profileWithMissingEducationFields = {
      ...mockProfile,
      education: [
        {
          school: 'Stanford',
          degree_name: null,
          field_of_study: null,
          starts_at: null,
          ends_at: null,
          description: null,
        },
      ],
    };

    await createLinkedInDocuments(
      '123',
      'John Doe',
      'https://linkedin.com/in/johndoe',
      profileWithMissingEducationFields,
    );

    // Verify education document was created with null fields
    expect(mockDatabaseService.insertOrUpdateDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        source_type: 'linkedin_education',
        source_unique_id: expect.stringContaining('officernd_member_123:education_stanford-unknown'),
        content: 'Stanford',
        metadata: expect.objectContaining({
          school: 'Stanford',
          degree_name: null,
          field_of_study: null,
          date_range: null,
        }),
      }),
    );
  });
});

describe('needsLinkedInUpdate', () => {
  it('should return true if lastUpdate is null', () => {
    expect(needsLinkedInUpdate(null)).toBe(true);
  });

  it('should return true if profile is older than maxAge', () => {
    const oldUpdate = Date.now() - 91 * 24 * 60 * 60 * 1000; // 91 days ago
    expect(needsLinkedInUpdate(oldUpdate)).toBe(true);
  });

  it('should return false if profile is newer than maxAge', () => {
    const recentUpdate = Date.now() - 89 * 24 * 60 * 60 * 1000; // 89 days ago
    expect(needsLinkedInUpdate(recentUpdate)).toBe(false);
  });

  it('should respect custom maxAge parameter', () => {
    const update = Date.now() - 31 * MILLISECONDS_PER_DAY; // 31 days ago
    expect(needsLinkedInUpdate(update, 30 * MILLISECONDS_PER_DAY)).toBe(true);
    expect(needsLinkedInUpdate(update, 32 * MILLISECONDS_PER_DAY)).toBe(false);
  });
});

describe('updateLinkedinForOfficerndIdIfNeeded', () => {
  const OFFICERND_ID_TEST = 'test-officernd-id';
  const recentUpdate = Date.now() - (DEFAULT_LINKEDIN_PROFLE_ALLOWED_AGE_DAYS - 1) * MILLISECONDS_PER_DAY;
  const defaultMember = {
    officernd_id: OFFICERND_ID_TEST,
    name: 'Test Member Name',
    linkedin_url: 'https://linkedin.com/in/testmember',
    last_linkedin_update: null,
  };

  it.each([
    {
      description: 'does not update if member has no LinkedIn URL',
      lastLinkedinUpdate: recentUpdate,
      member: { ...defaultMember, linkedin_url: null },
      shouldCallProxycurl: false,
    },
    {
      description: 'does not update if LinkedIn data is recent enough',
      lastLinkedinUpdate: recentUpdate,
      member: defaultMember,
      shouldCallProxycurl: false,
    },
    {
      description: 'updates if LinkedIn data is stale',
      lastLinkedinUpdate: Date.now() - 100 * MILLISECONDS_PER_DAY, // 100 days ago (longer than any default),
      member: defaultMember,
      shouldCallProxycurl: true,
    },
    {
      description: 'updates if LinkedIn data never updated (last_linkedin_update is null)',
      lastLinkedinUpdate: null,
      member: defaultMember,
      shouldCallProxycurl: true,
    },
  ])('%s', async ({ lastLinkedinUpdate, member, shouldCallProxycurl }) => {
    mockDatabaseService.getLastLinkedInUpdateForMember.mockResolvedValue(lastLinkedinUpdate);
    mockDatabaseService.getMember.mockResolvedValue(member);

    await updateLinkedinForMemberIfNeeded(OFFICERND_ID_TEST);
    if (shouldCallProxycurl) {
      expect(mockProxycurlService.getLinkedInProfile).toHaveBeenCalledWith(member.linkedin_url);
    } else {
      expect(mockProxycurlService.getLinkedInProfile).not.toHaveBeenCalled();
    }
  });
});
