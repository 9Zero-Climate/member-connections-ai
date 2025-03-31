import { config } from 'dotenv';
import { bulkUpsertMembers, close as closeDb } from '../services/database';
import { getAllMembers as getOfficeRnDMembers } from '../services/officernd';

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
