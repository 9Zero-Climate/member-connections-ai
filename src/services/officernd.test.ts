import { config } from 'dotenv';
import { getAllMembers } from './officernd';

// Load environment variables
config();

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as jest.Mock;

describe('OfficeRnD Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
  });

  it('should get all members', async () => {
    // Mock token response
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'mock-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    // Mock members response
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            _id: '1',
            name: 'John Doe',
            properties: {
              slack_id: 'U123',
              LinkedInViaAdmin: 'https://linkedin.com/in/johndoe',
            },
          },
        ]),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    const members = await getAllMembers();
    expect(Array.isArray(members)).toBe(true);
    if (members.length > 0) {
      const member = members[0];
      expect(member).toHaveProperty('officernd_id');
      expect(member).toHaveProperty('name');
      expect(member).toHaveProperty('slack_id');
      expect(member).toHaveProperty('linkedin_url');
    }
  });
});
