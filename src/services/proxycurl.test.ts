import { getLinkedInProfile } from './proxycurl';

const mockFetch = jest.fn();
global.fetch = mockFetch as jest.Mock;

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
      expect(mockFetch).toHaveBeenCalledTimes(1);
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
      // Set up mock 404 response for this specific test
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 404, statusText: 'Not Found' }));
      // Ensure API key is set for this test
      process.env.PROXYCURL_API_KEY = 'test-key';

      const profile = await getLinkedInProfile('https://linkedin.com/in/nonexistent');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(profile).toBeNull();
    });
  });
});
