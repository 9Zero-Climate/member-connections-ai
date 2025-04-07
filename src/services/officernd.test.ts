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

    // Mock members response with properties as an object
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            _id: '1',
            name: 'John Doe',
            properties: {
              slack_id: 'U123',
              LinkedInViaAdmin: 'https://linkedin.com/in/johndoe',
              other_prop: 'other_value',
            },
          },
          {
            _id: '2',
            name: 'Jane Smith',
            properties: {
              slack_id: 'U456',
              // Missing LinkedInViaAdmin for this member
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
    expect(mockFetch).toHaveBeenCalledTimes(2); // Token + Members
    expect(Array.isArray(members)).toBe(true);
    expect(members).toHaveLength(2);

    // Check first member
    expect(members[0]).toEqual({
      officernd_id: '1',
      name: 'John Doe',
      slack_id: 'U123',
      linkedin_url: 'https://linkedin.com/in/johndoe',
    });

    // Check second member (missing linkedin)
    expect(members[1]).toEqual({
      officernd_id: '2',
      name: 'Jane Smith',
      slack_id: 'U456',
      linkedin_url: null,
    });
  });
});
