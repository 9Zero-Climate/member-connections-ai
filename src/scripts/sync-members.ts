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

async function syncMembers(maxUpdates: number, allowedAgeDays: number): Promise<void> {
  logger.info('Checking config...');
  createConfig(process.env, 'member-sync');
  logger.info('Starting member synchronization...');

  try {
    // 1. Fetch all active members from OfficeRnD
    logger.info('Fetching members from OfficeRnD...');
    const officeRndMembers = await getAllMembers();
    logger.info(`Fetched ${officeRndMembers.length} active members from OfficeRnD.`);

    // 2. Upsert basic member info into our database
    logger.info('Upserting basic member info into database...');
    const dbMembers = await bulkUpsertMembers(officeRndMembers);
    logger.info(`Upserted ${dbMembers.length} members into the database.`);

    // 3. Fetch Notion member data
    logger.info('Fetching members from Notion...');
    const notionMembers = await fetchNotionMembers();
    logger.info(`Fetched ${notionMembers.length} members from Notion.`);

    // 4. Update database with Notion data (location tags, notion ID, RAG docs)
    logger.info('Updating members in database with Notion data...');
    await updateMembersFromNotion(notionMembers);
    logger.info('Finished updating database with Notion data.');

    logger.info('Starting LinkedIn profile synchronization...');

    // 5. Get last update times for LinkedIn docs
    logger.info('Fetching last LinkedIn update timestamps...');
    const lastUpdates = await getLastLinkedInUpdates();
    logger.info(`Found ${lastUpdates.size} members with existing LinkedIn documents.`);

    // 6. Prepare list of members with metadata for update check
    const membersWithMeta: MemberWithMeta[] = dbMembers.map((m) => ({
      id: m.officernd_id,
      name: m.name,
      linkedin_url: m.linkedin_url,
      metadata: {
        last_linkedin_update: lastUpdates.get(m.officernd_id) || undefined,
      },
    }));

    // 7. Filter members needing Linkedin profile updates
    const membersWithLinkedInUrl = membersWithMeta.filter(
      (m): m is MemberWithMeta & { linkedin_url: string } => m.linkedin_url !== null,
    );
    const membersToUpdate = getMembersToUpdate(membersWithLinkedInUrl, maxUpdates, allowedAgeDays);
    logger.info(
      `Identified ${membersToUpdate.length} members needing LinkedIn updates (max: ${maxUpdates}, age: ${allowedAgeDays} days).`,
    );

    // 8. Process updates
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
