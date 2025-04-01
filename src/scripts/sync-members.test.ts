import { config } from 'dotenv';
import { bulkUpsertMembers } from '../services/database';
import { getAllMembers as getOfficeRnDMembers } from '../services/officernd';
import { syncMembers } from './sync-members';

// Load environment variables
config();

// Mock dependencies
jest.mock('../services/officernd');
jest.mock('../services/database');

describe('Member Sync Script', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

    // Run sync
    await syncMembers();

    // Verify calls
    expect(getOfficeRnDMembers).toHaveBeenCalledTimes(1);
    expect(bulkUpsertMembers).toHaveBeenCalledTimes(1);
    expect(bulkUpsertMembers).toHaveBeenCalledWith(mockMembers);
  });

  it('should handle errors gracefully', async () => {
    // Mock error
    (getOfficeRnDMembers as jest.Mock).mockRejectedValue(new Error('API Error'));

    // Run sync and expect it to exit with error
    await expect(syncMembers()).rejects.toThrow('API Error');
  });
});
