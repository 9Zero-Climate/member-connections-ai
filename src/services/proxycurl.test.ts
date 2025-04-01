import { config } from 'dotenv';
import { deleteLinkedInDocuments, insertOrUpdateDoc } from './database';
import { createLinkedInDocuments, getLinkedInProfile, getMembersToUpdate, needsLinkedInUpdate } from './proxycurl';

// Load environment variables
config();

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as jest.Mock;

// Mock database functions
jest.mock('./database', () => ({
  insertOrUpdateDoc: jest.fn(),
  deleteLinkedInDocuments: jest.fn(),
  getDocBySource: jest.fn(),
  updateDoc: jest.fn(),
}));

describe('Proxycurl Service', () => {
  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    mockFetch.mockReset();
    // Reset environment variables
    process.env.PROXYCURL_API_KEY = 'test-key';
  });

  afterEach(() => {
    // Reset environment variables
    process.env.PROXYCURL_API_KEY = 'test-key';
  });

  describe('getLinkedInProfile', () => {
    it('should fetch and parse LinkedIn profile data', async () => {
      // Mock successful response
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
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
            languages: [{ name: 'English', proficiency: 'Native' }],
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      const profile = await getLinkedInProfile('https://linkedin.com/in/test');
      expect(profile).not.toBeNull();
      if (profile) {
        expect(profile.headline).toBe('Software Engineer');
        expect(profile.summary).toBe('Experienced developer');
        expect(profile.experiences).toHaveLength(1);
        expect(profile.education).toHaveLength(1);
        expect(profile.skills).toHaveLength(2);
        expect(profile.languages).toHaveLength(1);
      }
    });

    it('should return null for non-existent profile', async () => {
      // Mock 404 response
      mockFetch.mockResolvedValueOnce(
        new Response(null, {
          status: 404,
          statusText: 'Not Found',
        }),
      );

      const profile = await getLinkedInProfile('https://linkedin.com/in/nonexistent');
      expect(profile).toBeNull();
    });

    it('should throw error if API key is not configured', async () => {
      // Save original API key
      const originalKey = process.env.PROXYCURL_API_KEY;

      // Clear API key
      process.env.PROXYCURL_API_KEY = undefined;

      await expect(getLinkedInProfile('https://linkedin.com/in/test')).rejects.toThrow(
        'Proxycurl API key not configured',
      );

      // Verify fetch was not called
      expect(mockFetch).not.toHaveBeenCalled();

      // Restore original API key
      process.env.PROXYCURL_API_KEY = originalKey;
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
      languages: [{ name: 'English', proficiency: 'Native' }],
    };

    it('should create all document types', async () => {
      await createLinkedInDocuments('123', 'John Doe', 'https://linkedin.com/in/johndoe', mockProfile);

      // Verify document deletion
      expect(deleteLinkedInDocuments).toHaveBeenCalledWith('123');

      // Verify document creation
      expect(insertOrUpdateDoc).toHaveBeenCalledTimes(6); // headline, summary, experience, education, skills, languages

      // Verify headline document
      expect(insertOrUpdateDoc).toHaveBeenCalledWith(
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
      expect(insertOrUpdateDoc).toHaveBeenCalledWith(
        expect.objectContaining({
          source_type: 'linkedin_experience',
          source_unique_id: expect.stringContaining('officernd_member_123:experience_9zero-2020-2024'),
          content: expect.stringContaining('Software Engineer at 9Zero'),
          embedding: null,
          metadata: expect.objectContaining({
            member_name: 'John Doe',
            linkedin_url: 'https://linkedin.com/in/johndoe',
            title: 'Software Engineer',
            company: '9Zero',
            date_range: '2020-2024',
            location: 'San Francisco',
          }),
        }),
      );

      // Verify education document
      expect(insertOrUpdateDoc).toHaveBeenCalledWith(
        expect.objectContaining({
          source_type: 'linkedin_education',
          source_unique_id: expect.stringContaining('officernd_member_123:education_stanford-2016-2020'),
          content: expect.stringContaining('Stanford'),
          embedding: null,
          metadata: expect.objectContaining({
            member_name: 'John Doe',
            linkedin_url: 'https://linkedin.com/in/johndoe',
            school: 'Stanford',
            degree_name: 'BS',
            field_of_study: 'Computer Science',
            date_range: '2016-2020',
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

      // Verify document deletion
      expect(deleteLinkedInDocuments).toHaveBeenCalledWith('123');

      // Verify no documents were created
      expect(insertOrUpdateDoc).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      // Mock database error
      (deleteLinkedInDocuments as jest.Mock).mockRejectedValueOnce(new Error('Database error'));

      await expect(
        createLinkedInDocuments('123', 'John Doe', 'https://linkedin.com/in/johndoe', mockProfile),
      ).rejects.toThrow('Database error');
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
      const update = Date.now() - 31 * 24 * 60 * 60 * 1000; // 31 days ago
      expect(needsLinkedInUpdate(update, 30 * 24 * 60 * 60 * 1000)).toBe(true);
      expect(needsLinkedInUpdate(update, 32 * 24 * 60 * 60 * 1000)).toBe(false);
    });
  });

  describe('getMembersToUpdate', () => {
    const now = Date.now();
    const twoMonthsAgo = now - 60 * 24 * 60 * 60 * 1000;

    it('should prioritize members without LinkedIn data', () => {
      const members = [
        { id: '1', name: 'New User', linkedin_url: 'https://linkedin.com/in/new', metadata: {} },
        {
          id: '2',
          name: 'Old User',
          linkedin_url: 'https://linkedin.com/in/old',
          metadata: { last_linkedin_update: twoMonthsAgo },
        },
      ];

      const result = getMembersToUpdate(members);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('1'); // New user should be first
      expect(result[1].id).toBe('2'); // Old user should be second
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

    it('should not include recently updated members', () => {
      const members = [
        { id: '1', name: 'New User', linkedin_url: 'https://linkedin.com/in/new', metadata: {} },
        {
          id: '2',
          name: 'Recent User',
          linkedin_url: 'https://linkedin.com/in/recent',
          metadata: { last_linkedin_update: now - 1000 },
        },
        {
          id: '3',
          name: 'Old User',
          linkedin_url: 'https://linkedin.com/in/old',
          metadata: { last_linkedin_update: twoMonthsAgo },
        },
      ];

      const result = getMembersToUpdate(members);
      expect(result).toHaveLength(2);
      expect(result.map((m) => m.id)).toEqual(['1', '3']); // Should only include new and old users
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
});
