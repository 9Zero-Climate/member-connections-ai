import { config } from 'dotenv';
import { getMembersToUpdate } from './linkedin';

// Load environment variables
config();

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
