import { type Member, bulkUpsertMembers, close as closeDb, getLastLinkedInUpdates } from '../services/database';
import { getAllMembers as getOfficeRnDMembers } from '../services/officernd';
import {
  type ProxycurlProfile,
  createLinkedInDocuments,
  getLinkedInProfile,
  getMembersToUpdate,
} from '../services/proxycurl';

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

    // Get IDs of members with LinkedIn URLs
    const memberIdsWithLinkedIn = members.filter((m) => m.linkedin_url).map((m) => m.officernd_id);

    // Get last update timestamps for these members
    const lastUpdatesMap = await getLastLinkedInUpdates(memberIdsWithLinkedIn);

    // Prepare members array for getMembersToUpdate function
    const membersFormattedForUpdateCheck = members
      .filter((m) => m.linkedin_url) // Only consider members with LinkedIn
      .map((member) => ({
        id: member.officernd_id, // Use officernd_id as id
        name: member.name,
        linkedin_url: member.linkedin_url as string, // Assert non-null based on filter
        metadata: {
          // Convert null from DB to undefined for the getMembersToUpdate function
          last_linkedin_update: lastUpdatesMap.get(member.officernd_id) ?? undefined,
        },
      }));

    const membersToUpdate = getMembersToUpdate(membersFormattedForUpdateCheck);

    console.log(`Found ${membersToUpdate.length} members needing LinkedIn updates based on criteria.`);

    // Limit updates per run to avoid hitting API limits
    const MAX_LINKEDIN_UPDATES = 10;
    const chosenMembers = membersToUpdate.slice(0, MAX_LINKEDIN_UPDATES);

    if (chosenMembers.length > 0) {
      console.log(`Chose ${chosenMembers.length} members to update via Proxycurl`);

      for (const member of chosenMembers) {
        // member here has shape { id, name, linkedin_url }
        console.log(`Fetching LinkedIn profile for ${member.name}...`);
        const profileData: ProxycurlProfile | null = await getLinkedInProfile(member.linkedin_url);
        if (profileData) {
          // Pass officernd_id (which is member.id here), name, url, and profile
          await createLinkedInDocuments(member.id, member.name, member.linkedin_url, profileData);
          console.log(`Created/Updated LinkedIn documents for ${member.name}`);
        } else {
          console.log(`Could not fetch LinkedIn profile for ${member.name} from ${member.linkedin_url}`);
        }
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
