import { ConfigContext, validateConfig } from '../config';
import {
  bulkUpsertMembers,
  closeDbConnection,
  deleteTypedDocumentsForMember,
  insertOrUpdateDoc,
} from '../services/database';
import { normalizeLinkedInUrl } from '../services/linkedin';
import { logger } from '../services/logger';
import { type OfficeRnDMemberData, getAllOfficeRnDMembersData } from '../services/officernd';

/**
 * Sync data from OfficeRnD
 * 1. Fetch member data from OfficeRnD
 * 2. Insert into Members table
 * 3. Replace ORND-related RAG docs
 * @returns The inserted/updated members
 */
export async function syncOfficeRnD(): Promise<void> {
  logger.info('Starting OfficeRnD sync...');
  validateConfig(process.env, ConfigContext.SyncOfficeRnD);

  try {
    // 1. Fetch data
    const officeRndMembersData = await getAllOfficeRnDMembersData();

    // 2. Upsert members
    const members = officeRndMembersData.map(({ id, name, slackId, linkedinUrl, location }) => {
      return {
        name,
        officernd_id: id,
        slack_id: slackId,
        linkedin_url: linkedinUrl ? normalizeLinkedInUrl(linkedinUrl) : null,
        location,
      };
    });
    await bulkUpsertMembers(members);

    // 3. Replace RAG docs
    for (const memberData of officeRndMembersData) {
      await deleteOfficeRnDDocuments(memberData.id);
      await createOfficeRnDDocuments(memberData);
    }
  } finally {
    await closeDbConnection();
  }

  logger.info('OfficeRnD sync complete');
}

const OFFICERND_SOURCE_TYPE_PREFIX = 'officernd_';

async function deleteOfficeRnDDocuments(officerndMemberId: string): Promise<void> {
  return deleteTypedDocumentsForMember(officerndMemberId, OFFICERND_SOURCE_TYPE_PREFIX);
}

export async function createOfficeRnDDocuments(memberData: OfficeRnDMemberData): Promise<void> {
  const { id, name, sector, subsector, currentRole, type, blurb } = memberData;

  const baseMetadata = {
    officernd_member_id: id,
    member_name: name,
  };

  const expertiseTags = [
    ...(sector || []), // Sector is a multi-select
    subsector, // Subsector is an open-ended text field. Treat it as a single "tag"
    currentRole,
    ...(type || []), // Type is a multi-select
  ].filter(Boolean);

  if (expertiseTags.length > 0) {
    const sourceTypeExpertise = `${OFFICERND_SOURCE_TYPE_PREFIX}expertise`;
    await insertOrUpdateDoc({
      source_type: sourceTypeExpertise,
      source_unique_id: `officernd_member_${id}:${sourceTypeExpertise}`,
      content: `Expertise and interests: ${expertiseTags.join(', ')}`,
      metadata: { ...baseMetadata, tags: expertiseTags },
    });
  }

  if (blurb != null) {
    const sourceTypeBlurb = `${OFFICERND_SOURCE_TYPE_PREFIX}blurb`;
    await insertOrUpdateDoc({
      source_type: sourceTypeBlurb,
      source_unique_id: `officernd_member_${id}:${sourceTypeBlurb}`,
      content: `Talk to me about: ${blurb}`,
      metadata: baseMetadata,
    });
  }
}
