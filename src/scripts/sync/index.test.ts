import { config } from 'dotenv';
import { syncAll } from '.';
import {
  bulkUpsertMembers,
  close as closeDb,
  getMembersWithLastLinkedInUpdates,
  updateMembersFromNotion,
} from '../../services/database';
import { getAllMembers as getOfficeRnDMembers } from '../../services/officernd';
import { getLinkedInProfile } from '../../services/proxycurl';
import { getMembersToUpdate } from './linkedin';

// Load environment variables
config();

// Mock dependencies
jest.mock('../../services/officernd', () => ({
  getAllMembers: jest.fn().mockResolvedValue([
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
  ]),
}));
jest.mock('../../services/database', () => {
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

  return {
    bulkUpsertMembers: jest.fn().mockResolvedValue(mockMembers),
    getMembersWithLastLinkedInUpdates: jest.fn().mockResolvedValue([
      { id: '1', last_linkedin_update: 1717334400000 },
      { id: '2', last_linkedin_update: 1717334400000 },
    ]),
    updateMembersFromNotion: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  };
});
jest.mock('../../services/proxycurl', () => {
  const mockMembers = [
    {
      id: '1',
      name: 'John Doe',
      linkedin_url: 'https://linkedin.com/in/johndoe',
    },
    {
      id: '2',
      name: 'Jane Smith',
      linkedin_url: 'https://linkedin.com/in/janesmith',
    },
  ];

  return {
    getMembersToUpdate: jest.fn().mockImplementation((members) => mockMembers),
    getLinkedInProfile: jest.fn().mockResolvedValue({
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
    }),
    createLinkedInDocuments: jest.fn().mockResolvedValue(undefined),
  };
});
jest.mock('../../services/notion', () => ({
  fetchNotionMembers: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../services/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Member Sync Script', () => {
  // Store original env vars
  const originalEnv = { ...process.env };

  // Mock members data
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

  beforeAll(() => {
    // Set test environment variables
    process.env = {
      ...process.env,
      OFFICERND_API_URL: 'https://test.officernd.com',
      OFFICERND_ORG_SLUG: 'test-org',
      OFFICERND_CLIENT_ID: 'test-client-id',
      OFFICERND_CLIENT_SECRET: 'test-client-secret',
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  afterAll(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('successful operations', () => {
    it('should sync members successfully', async () => {
      await syncAll(10, 30);

      // Verify calls
      expect(getOfficeRnDMembers).toHaveBeenCalledTimes(1);
      expect(bulkUpsertMembers).toHaveBeenCalledTimes(1);
      expect(bulkUpsertMembers).toHaveBeenCalledWith(mockMembers);
      expect(getLinkedInProfile).toHaveBeenCalledTimes(2); // Once for each member
      expect(closeDb).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    it('should handle API errors gracefully', async () => {
      // Override the default mock for this specific test
      (getOfficeRnDMembers as jest.Mock).mockRejectedValueOnce(new Error('API Error'));
      await expect(syncAll(10, 30)).rejects.toThrow('API Error');
    });

    it('should handle undefined response from OfficeRnD', async () => {
      (getOfficeRnDMembers as jest.Mock).mockResolvedValueOnce(undefined);
      await expect(syncAll(10, 30)).rejects.toThrow();
    });

    it('should handle non-array response from OfficeRnD', async () => {
      (getOfficeRnDMembers as jest.Mock).mockResolvedValueOnce({} as unknown);
      await expect(syncAll(10, 30)).rejects.toThrow();
    });
  });
});
