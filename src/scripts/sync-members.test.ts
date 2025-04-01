import { config } from 'dotenv';
import { bulkUpsertMembers, getLastLinkedInUpdates } from '../services/database';
import { getAllMembers as getOfficeRnDMembers } from '../services/officernd';
import { getLinkedInProfile, getMembersToUpdate } from '../services/proxycurl';
import { syncMembers } from './sync-members';

// Load environment variables
config();

// Mock dependencies
jest.mock('../services/officernd');
jest.mock('../services/database');
jest.mock('../services/proxycurl');

describe('Member Sync Script', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock successful LinkedIn profile fetch
    (getLinkedInProfile as jest.Mock).mockResolvedValue({
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
    });

    // Mock getMembersToUpdate to return the same members
    (getMembersToUpdate as jest.Mock).mockImplementation((members) => members);
  });

  it('should sync members successfully', async () => {
    // Mock OfficeRnD members
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

    (getOfficeRnDMembers as jest.Mock).mockResolvedValue(mockMembers);
    (bulkUpsertMembers as jest.Mock).mockResolvedValue(mockMembers);
    (getLastLinkedInUpdates as jest.Mock).mockResolvedValue(
      new Map([
        ['1', 1717334400000],
        ['2', 1717334400000],
      ]),
    );
    // Run sync
    await syncMembers();

    // Verify calls
    expect(getOfficeRnDMembers).toHaveBeenCalledTimes(1);
    expect(bulkUpsertMembers).toHaveBeenCalledTimes(1);
    expect(bulkUpsertMembers).toHaveBeenCalledWith(mockMembers);
    expect(getLinkedInProfile).toHaveBeenCalledTimes(2); // Once for each member
  });

  it('should handle errors gracefully', async () => {
    // Mock error
    (getOfficeRnDMembers as jest.Mock).mockRejectedValue(new Error('API Error'));

    // Run sync and expect it to exit with error
    await expect(syncMembers()).rejects.toThrow('API Error');
  });
});
