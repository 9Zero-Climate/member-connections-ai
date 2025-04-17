import { Command } from 'commander';
import { ConfigContext, validateConfig } from '../../config';
import {
  type Member,
  type MemberWithLinkedInUpdateMetadata,
  getMembersWithLastLinkedInUpdates,
} from '../../services/database';
import { logger } from '../../services/logger';
import { type ProxycurlProfile, createLinkedInDocuments, getLinkedInProfile } from '../../services/proxycurl';

// Constants for time calculations
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

interface LinkedInSyncOptions {
  maxUpdates: number;
  allowedAgeDays: number;
}

const defaultSyncOptions: LinkedInSyncOptions = {
  maxUpdates: 100,
  allowedAgeDays: 7,
};

type MemberWithLinkedInUrl = MemberWithLinkedInUpdateMetadata & { linkedin_url: string };

/**
 * Sync data from LinkedIn. This is expensive, so we are careful to only fetch the data we really need
 * 1. Determine who needs updated LinkedIn data
 * 2. Fetch data from LinkedIn for those members
 * 3. Replace all LinkedIn RAG docs for to these members
 */
export async function syncLinkedIn(syncOptionOverrides: LinkedInSyncOptions): Promise<void> {
  logger.info('Starting LinkedIn profile synchronization...');
  validateConfig(process.env, ConfigContext.SyncLinkedIn);

  const syncOptions = { ...defaultSyncOptions, ...syncOptionOverrides };
  const { maxUpdates, allowedAgeDays } = syncOptions;

  // Get all members along with their last linkedin update times
  const membersWithLastLinkedInUpdates = await getMembersWithLastLinkedInUpdates();

  const membersToUpdate = getMembersToUpdate(membersWithLastLinkedInUpdates, maxUpdates, allowedAgeDays);

  // Process updates
  for (const member of membersToUpdate) {
    console.log(`Fetching LinkedIn profile for ${member.name}...`);
    const profileData: ProxycurlProfile | null = await getLinkedInProfile(member.linkedin_url);
    if (profileData) {
      await createLinkedInDocuments(member.id, member.name, member.linkedin_url, profileData);
      console.log(`Created/Updated LinkedIn documents for ${member.name}`);
    } else {
      console.log(`Could not fetch LinkedIn profile for ${member.name} from ${member.linkedin_url}`);
    }
  }

  console.log('LinkedIn profile sync completed');
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
  maxUpdates = 100,
  allowedAgeDays = 7,
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

const program = new Command();
program
  .name('sync-linkedin')
  .description('Syncs data from LinkedIn')
  .option('--max-updates <number>', 'Maximum number of profiles to fetch updates for', Number.parseInt)
  .option(
    '--allowed-age-days <number>',
    'Grace period in days before considering a profile out of date',
    Number.parseInt,
  )
  .action(syncLinkedIn);

program.parse();
