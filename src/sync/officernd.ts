import { ConfigContext, validateConfig } from '../config';
import {
  type BasicMemberForUpsert,
  bulkUpsertMembers,
  closeDbConnection,
  deleteLinkedinDocumentsForOfficerndId,
  deleteMember,
  deleteTypedDocumentsForMember,
  insertOrUpdateDoc,
  updateMember,
} from '../services/database';
import { normalizeLinkedInUrl } from '../services/linkedin';
import { logger } from '../services/logger';
import {
  OFFICERND_ACTIVE_MEMBER_STATUS,
  type OfficeRnDMemberData,
  type OfficeRnDRawCheckinData,
  type OfficeRnDRawMemberData,
  type OfficeRnDRawWebhookPayload,
  cleanMember,
  getAllOfficeRnDMembersData,
  getOfficeLocation,
} from '../services/officernd';
import { updateLinkedinForMemberIfNeeded } from './linkedin';

export const prepMemberForDb = (orndMember: OfficeRnDMemberData): BasicMemberForUpsert => {
  const { id, name, slackId, linkedinUrl, location } = orndMember;
  return {
    name,
    officernd_id: id,
    slack_id: slackId,
    linkedin_url: linkedinUrl ? normalizeLinkedInUrl(linkedinUrl) : null,
    location,
  };
};

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
    const members = officeRndMembersData.map(prepMemberForDb);
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

/**
 * Handle checkin event webhooks from officernd
 *
 * Update the member's checkin_location_today attribute with:
 *  - checkin_location_today=location if they are checked in
 *  - checkin_location_today=null if they are checked out
 */
export const handleCheckinEvent = async (payload: OfficeRnDRawWebhookPayload) => {
  if (!['checkin.created', 'checkin.updated'].includes(payload.eventType)) {
    logger.error({ payload }, `Unsupported event type: ${payload.eventType}`);
    throw new Error(`Unsupported event type: ${payload.eventType}`);
  }

  const checkin = payload.data.object as OfficeRnDRawCheckinData;

  if (checkin.office == null) {
    throw new Error(`checkin.office missing, can't set checkin location`);
  }

  // The checkin object has a `start` and `end` date.
  // When a member checks in: a new checkin object is created, with start=<checkin time> and end=null
  // When a member checks out: the checkin object is updated with end=<checkout time>
  // So if end date is null, it indicates the member is currently checked in
  await updateMember(checkin.member, {
    checkin_location_today: checkin.end == null ? getOfficeLocation(checkin.office) : null,
  });
};

export const handleMemberEvent = async (payload: OfficeRnDRawWebhookPayload) => {
  logger.info({ payload }, 'Handling member created/updated event');
  const rawMember = payload.data.object as OfficeRnDRawMemberData;

  if (rawMember.calculatedStatus !== OFFICERND_ACTIVE_MEMBER_STATUS) {
    logger.info({ orndMemberId: rawMember._id }, 'Member is not active, removing');
    await deleteMember(rawMember._id);
    await deleteOfficeRnDDocuments(rawMember._id);
    await deleteLinkedinDocumentsForOfficerndId(rawMember._id);
    return;
  }

  logger.info({ rawMember }, 'Member is active, upserting');
  const cleanedMember = cleanMember(rawMember);
  const memberForUpsert = prepMemberForDb(cleanedMember);

  await bulkUpsertMembers([memberForUpsert]);
  await deleteOfficeRnDDocuments(cleanedMember.id);
  await createOfficeRnDDocuments(cleanedMember);
  await updateLinkedinForMemberIfNeeded(cleanedMember.id);

  logger.info({ payload }, 'Member created/updated');
};

export const handleOfficeRnDWebhook = async (payload: OfficeRnDRawWebhookPayload) => {
  if (['checkin.created', 'checkin.updated'].includes(payload.eventType)) {
    await handleCheckinEvent(payload);
  } else if (['member.created', 'member.updated'].includes(payload.eventType)) {
    await handleMemberEvent(payload);
  } else {
    logger.warn({ payload }, `Unsupported event type: ${payload.eventType}`);
    throw new Error(`Unsupported event type: ${payload.eventType}`);
  }
};
