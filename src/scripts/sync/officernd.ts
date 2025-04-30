import { ConfigContext, validateConfig } from '../../config';
import { bulkUpsertMembers, closeDbConnection } from '../../services/database';
import { logger } from '../../services/logger';
import { OfficeRnDMemberData, getAllOfficeRnDMembersData } from '../../services/officernd';

/**
 * Sync data from OfficeRnD
 * 1. Fetch member data from OfficeRnD
 * 2. Insert into Members table
 * @returns The inserted/updated members
 */
export async function syncOfficeRnD(): Promise<void> {
  logger.info('Starting OfficeRnD sync...');
  validateConfig(process.env, ConfigContext.SyncOfficeRnD);

  try {
    const officeRndMembersData = await getAllOfficeRnDMembersData();
    const members = officeRndMembersData.map(({ id, name, slackId, linkedinUrl, location }) => {
      return {
        name,
        officernd_id: id,
        slack_id: slackId,
        linkedin_url: linkedinUrl,
        location,
      };
    });
    await bulkUpsertMembers(members);
  } finally {
    await closeDbConnection();
  }

  logger.info('OfficeRnD sync complete');
}
