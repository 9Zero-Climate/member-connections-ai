import { config } from 'dotenv';
import { bulkUpsertMembers, close as closeDb, getLastLinkedInUpdate } from '../services/database';
import { getAllMembers as getOfficeRnDMembers } from '../services/officernd';
import { createLinkedInDocuments, getLinkedInProfile, getMembersToUpdate } from '../services/proxycurl';

// Load environment variables
config();

async function syncMembers() {
  try {
    console.log('Starting member sync...');

    // Get all members from OfficeRnD
    const members = await getOfficeRnDMembers();
    console.log(`Found ${members.length} members in OfficeRnD`);

    // Sync all members in bulk
    await bulkUpsertMembers(members);
    console.log(`Member sync completed successfully - synced ${members.length} members`);

    // Sync LinkedIn profiles
    console.log('Starting LinkedIn profile sync...');
    const membersWithLinkedIn = members.filter(
      (member): member is typeof member & { linkedin_url: string } => member.linkedin_url !== null,
    );
    console.log(`Found ${membersWithLinkedIn.length} members with LinkedIn profiles`);

    // Get last update times for all members
    const membersWithLastUpdate = await Promise.all(
      membersWithLinkedIn.map(async (member) => {
        const lastUpdate = await getLastLinkedInUpdate(member.officernd_id);
        return {
          id: member.officernd_id,
          name: member.name,
          linkedin_url: member.linkedin_url,
          metadata: {
            last_linkedin_update: lastUpdate || undefined,
          },
        };
      }),
    );

    // Get members that need updates, limited to 100 per run
    const membersToUpdate = getMembersToUpdate(membersWithLastUpdate);
    console.log(`Found ${membersToUpdate.length} members needing LinkedIn updates`);

    for (const member of membersToUpdate) {
      console.log(`Fetching LinkedIn profile for ${member.name}...`);
      const profile = await getLinkedInProfile(member.linkedin_url);

      if (profile) {
        await createLinkedInDocuments(member.id, member.name, member.linkedin_url, profile);
        console.log(`Created LinkedIn documents for ${member.name}`);
      } else {
        console.log(`No LinkedIn profile found for ${member.name}`);
      }
    }
    console.log('LinkedIn profile sync completed');
  } catch (error) {
    console.error('Error syncing members:', error);
    throw error;
  } finally {
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
