import { Command } from 'commander';
/**
 * Script to synchronize member data from OfficeRnD,
 * update/fetch LinkedIn profiles via Proxycurl,
 * and store structured data & embeddings in PostgreSQL.
 */
import { createConfig } from '../config';
import {
  bulkUpsertMembers,
  close as closeDb,
  getLastLinkedInUpdates,
  Member,
  updateMembersFromNotion,
} from '../services/database';
import { logger } from '../services/logger';
import { fetchNotionMembers } from '../services/notion';
import { getAllMembers } from '../services/officernd';
import {
  type ProxycurlProfile,
  createLinkedInDocuments,
  getLinkedInProfile,
  getMembersToUpdate,
} from '../services/proxycurl';

interface MemberWithMeta {
  id: string;
  name: string;
  linkedin_url: string | null;
  metadata?: {
    last_linkedin_update?: number;
  };
}

/**
 * Sync data from OfficeRnD
 * 1. Fetch member data from OfficeRnD
 * 2. Insert into Members table
 * @returns The inserted/updated members
 */
async function syncOfficeRnD(): Promise<Member[]> {
  logger.info('Starting OfficeRnD sync...');
  const officeRndMembers = await getAllMembers();
  const dbMembers = await bulkUpsertMembers(officeRndMembers);
  logger.info('OfficeRnD sync complete');

  return dbMembers;
}

/**
 * Sync data from Notion
 * 1. Fetch member data from Notion
 * 2. Update the Members table, and replace all Notion RAG docs for to this member
 */
async function syncNotion(): Promise<void> {
  logger.info('Starting Notion sync...');
  const notionMembers = await fetchNotionMembers();
  await updateMembersFromNotion(notionMembers);
  logger.info('Notion sync complete');
}

/**
 * Sync data from LinkedIn. This is expensive, so we are careful to only fetch the data we really need
 * 1. Determine who needs updated LinkedIn data
 * 2. Fetch data from LinkedIn for those members
 * 3. Update the Members table, and replace all LinkedIn RAG docs for to this member
 */
async function syncLinkedIn(dbMembers: Member[], maxUpdates: number, allowedAgeDays: number): Promise<void> {
  logger.info('Starting LinkedIn profile synchronization...');

  // Get last update times for LinkedIn docs
  logger.info('Fetching last LinkedIn update timestamps...');
  const lastUpdates = await getLastLinkedInUpdates();
  logger.info(`Found ${lastUpdates.size} members with existing LinkedIn documents.`);

  // Prepare list of members with metadata for update check
  const membersWithMeta: MemberWithMeta[] = dbMembers.map((m) => ({
    id: m.officernd_id,
    name: m.name,
    linkedin_url: m.linkedin_url,
    metadata: {
      last_linkedin_update: lastUpdates.get(m.officernd_id) || undefined,
    },
  }));

  // Filter members needing Linkedin profile updates
  const membersWithLinkedInUrl = membersWithMeta.filter(
    (m): m is MemberWithMeta & { linkedin_url: string } => m.linkedin_url !== null,
  );
  const membersToUpdate = getMembersToUpdate(membersWithLinkedInUrl, maxUpdates, allowedAgeDays);
  logger.info(
    `Identified ${membersToUpdate.length} members needing LinkedIn updates (max: ${maxUpdates}, age: ${allowedAgeDays} days).`,
  );

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

async function syncMembers(maxUpdates: number, allowedAgeDays: number): Promise<void> {
  logger.info('Checking config...');
  createConfig(process.env, 'member-sync');

  logger.info('Starting member synchronization...');
  try {
    const dbMembers = await syncOfficeRnD();
    await syncNotion();
    await syncLinkedIn(dbMembers, maxUpdates, allowedAgeDays);
  } finally {
    // Close database connection
    await closeDb();
  }
}

// Command-line interface setup
const program = new Command();
program
  .name('sync-members')
  .description('Syncs member data from OfficeRnD and Notion, updates LinkedIn profiles.')
  .option(
    '--max-updates <number>',
    'Maximum number of LinkedIn profiles to update',
    (value) => Number.parseInt(value, 10),
    100, // Default value
  )
  .option(
    '--allowed-age-days <number>',
    'Grace period in days before considering a LinkedIn profile out of date',
    (value) => Number.parseInt(value, 10),
    7, // Default value
  )
  .action((options) => {
    syncMembers(options.maxUpdates, options.allowedAgeDays);
  });

program.parse(process.argv);

// Export for potential testing or programmatic use
export { syncMembers };
