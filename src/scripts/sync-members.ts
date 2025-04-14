import { type Member, bulkUpsertMembers, close as closeDb, getLastLinkedInUpdates } from '../services/database';
import { getAllMembers as getOfficeRnDMembers } from '../services/officernd';
import {
  type ProxycurlProfile,
  createLinkedInDocuments,
  getLinkedInProfile,
  getMembersToUpdate,
} from '../services/proxycurl';
import { Command } from 'commander';

const program = new Command();

program
  .name('sync-members')
  .description('Sync OfficeRnD members and update LinkedIn profiles')
  .option('--max-updates <number>', 'Maximum number of LinkedIn profiles to update', '100')
  .option('--allowed-age-days <number>', 'Maximum age in days before update is needed', '7')
  .parse(process.argv);

const options = program.opts();
const maxUpdates = Number.parseInt(options.maxUpdates, 10);
const allowedAgeDays = Number.parseInt(options.allowedAgeDays, 10);

async function syncMembers() {
  try {
    console.log('Starting member sync...');

    // Get all members from OfficeRnD
    const members: Member[] = await getOfficeRnDMembers();
    console.log(`Found ${members.length} members in OfficeRnD`);

    // Store/update members in our database
    await bulkUpsertMembers(members);
    console.log('Member sync completed successfully - synced', members.length, 'members');

    console.log('Starting LinkedIn profile sync...');

    // Get last update timestamps for all members
    const lastUpdatesMap = await getLastLinkedInUpdates();
    console.log(`${lastUpdatesMap.size} last update timestamps found`);

    // Prepare members array for getMembersToUpdate function
    const membersFormattedForUpdateCheck = members
      .filter((m) => m.linkedin_url) // Only consider members with LinkedIn
      .map((member) => {
        const lastUpdated = lastUpdatesMap.get(member.officernd_id);
        const metadata = lastUpdated ? { last_linkedin_update: lastUpdated } : {};
        return {
          id: member.officernd_id, // Use officernd_id as id
          name: member.name,
          linkedin_url: member.linkedin_url as string, // Assert non-null based on filter
          metadata,
        };
      });

    console.log(`${membersFormattedForUpdateCheck.length} ORND members with LinkedIn URLs`);

    const membersToUpdate = getMembersToUpdate(membersFormattedForUpdateCheck, maxUpdates, allowedAgeDays);

    console.log(
      `Prioritzed top ${membersToUpdate.length} ORND members needing LinkedIn updates based on criteria (max allowed: ${maxUpdates}).`,
    );

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

// Run sync if this file is executed directly
if (require.main === module) {
  syncMembers().catch((error) => {
    console.error('Sync failed:', error);
    process.exit(1);
  });
}

export { syncMembers };
