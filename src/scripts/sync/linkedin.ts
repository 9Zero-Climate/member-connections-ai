import { Command } from 'commander';
import { ConfigContext, validateConfig } from '../../config';
import {
  type MemberWithLinkedInUpdateMetadata,
  closeDbConnection,
  getMembersWithLastLinkedInUpdates,
} from '../../services/database';
import { logger } from '../../services/logger';
import { createLinkedInDocuments, getLinkedInProfile } from '../../services/proxycurl';

// Constants for time calculations
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

interface LinkedInSyncOptions {
  maxUpdates: number;
  allowedAgeDays: number;
}

const DEFAULT_MAX_UPDATES = 100;
const DEFAULT_ALLOWED_AGE_DATES = 7;

const defaultSyncOptions: LinkedInSyncOptions = {
  maxUpdates: DEFAULT_MAX_UPDATES,
  allowedAgeDays: DEFAULT_ALLOWED_AGE_DATES,
};

type MemberWithLinkedInUrl = MemberWithLinkedInUpdateMetadata & { linkedin_url: string };

/**
 * Sync data from LinkedIn. This is expensive, so we are careful to only fetch the data we really need
 * 1. Determine who needs updated LinkedIn data
 * 2. Fetch data from LinkedIn for those members
 * 3. Replace all LinkedIn RAG docs for to these members
 */
export async function syncLinkedIn(syncOptionOverrides?: LinkedInSyncOptions): Promise<void> {
  logger.info('Starting LinkedIn profile synchronization...');
  validateConfig(process.env, ConfigContext.SyncLinkedIn);

  const syncOptions = { ...defaultSyncOptions, ...syncOptionOverrides };
  const { maxUpdates, allowedAgeDays } = syncOptions;

  try {
    // Get all members along with their last linkedin update times
    const membersWithLastLinkedInUpdates = await getMembersWithLastLinkedInUpdates();

    const membersToUpdate = getMembersToUpdate(membersWithLastLinkedInUpdates, maxUpdates, allowedAgeDays);

    // Process updates
    for (const member of membersToUpdate) {
      logger.info(`Fetching LinkedIn profile for ${member.name}...`);
      const profileData = await getLinkedInProfile(member.linkedin_url);
      if (profileData) {
        await createLinkedInDocuments(member.id, member.name, member.linkedin_url, profileData);
        logger.info(`Created/Updated LinkedIn documents for ${member.name}`);
      } else {
        logger.info(`Could not fetch LinkedIn profile for ${member.name} from ${member.linkedin_url}`);
      }
    }

    logger.info('LinkedIn profile sync completed');
  } finally {
    await closeDbConnection();
  }
}

/**
 * Get members that need LinkedIn updates, prioritizing those without data
 * @param members - Array of members with their metadata
 * @param maxUpdates - Maximum number of profiles to update (updates cost 1 proxycurl credit each, around 2 cents per credit)
 * @param allowedAgeDays - Linkedin profile data won't be updated until this many days after the last update
 * @returns Array of members that need updates, limited to maxUpdates
 */
export function getMembersToUpdate(
  members: MemberWithLinkedInUpdateMetadata[],
  maxUpdates = DEFAULT_MAX_UPDATES,
  allowedAgeDays = DEFAULT_ALLOWED_AGE_DATES,
): MemberWithLinkedInUrl[] {
  const now = Date.now();
  const minimumUpdateAge = allowedAgeDays * MILLISECONDS_PER_DAY;
  const cutoffTime = now - minimumUpdateAge;

  // Filter members down to:
  //  - members for whom we have a LinkedIn url
  //  - members who actually need updates (last update is before cutoff time)
  const filteredMembers = members
    .filter((member): member is MemberWithLinkedInUrl => member.linkedin_url !== null)
    .filter((member) => {
      const lastUpdate = member.last_linkedin_update;
      const updateNeeded = !lastUpdate || lastUpdate < cutoffTime;
      return updateNeeded;
    });

  logger.info(`Members with LinkedIn url who need updates: ${filteredMembers.length}`);

  // Sort members by priority:
  // 1. No LinkedIn data (no last_linkedin_update)
  // 2. Oldest updates first
  const sortedMembers = filteredMembers.sort((a, b) => {
    const aUpdate = a.last_linkedin_update;
    const bUpdate = b.last_linkedin_update;

    // If neither has an update, maintain original order
    if (!aUpdate && !bUpdate) return 0;
    // If only one has an update, prioritize the one without
    if (!aUpdate) return -1;
    if (!bUpdate) return 1;
    // If both have updates, prioritize the older one
    return aUpdate - bUpdate;
  });

  // Cut down to the max number of updates
  const membersToUpdate = sortedMembers.slice(0, maxUpdates);

  logger.info(
    `Selected ${membersToUpdate.length} members to update (max: ${maxUpdates}, age: ${allowedAgeDays} days).`,
  );

  return membersToUpdate;
}
