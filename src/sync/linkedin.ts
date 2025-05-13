import { ConfigContext, validateConfig } from '../config';
import {
  type MemberWithLinkedInUpdateMetadata,
  closeDbConnection,
  deleteTypedDocumentsForMember,
  getMembersWithLastLinkedInUpdates,
  insertOrUpdateDoc,
} from '../services/database';
import { logger } from '../services/logger';
import { type ProxycurlDateObject, type ProxycurlProfile, getLinkedInProfile } from '../services/proxycurl';
import { DEFAULT_LINKEDIN_PROFLE_ALLOWED_AGE_DAYS } from './linkedin_constants';

// Constants for time calculations
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

type LinkedInSyncOptions = {
  maxUpdates: number;
  allowedAgeDays: number;
};

type LinkedInSyncOptionOverrides =
  | undefined
  | {
      maxUpdates?: unknown;
      allowedAgeDays?: unknown;
    };

const DEFAULT_MAX_UPDATES = 100;

type MemberWithLinkedInUpdateMetadataAndUrl = MemberWithLinkedInUpdateMetadata & { linkedin_url: string };

/**
 * Sync data from LinkedIn. This is expensive, so we are careful to only fetch the data we really need
 * 1. Determine who needs updated LinkedIn data
 * 2. Fetch data from LinkedIn for those members
 * 3. Replace all LinkedIn RAG docs for to these members
 */
export async function syncLinkedIn(syncOptionOverrides?: LinkedInSyncOptionOverrides): Promise<void> {
  logger.info('Starting LinkedIn profile synchronization...');
  validateConfig(process.env, ConfigContext.SyncLinkedIn);

  try {
    const { maxUpdates, allowedAgeDays } = getValidSyncOptions(syncOptionOverrides);

    // Get all members along with their last linkedin update times
    const membersWithLastLinkedInUpdates = await getMembersWithLastLinkedInUpdates();

    const membersToUpdate = getMembersToUpdate(membersWithLastLinkedInUpdates, maxUpdates, allowedAgeDays);

    // Process updates
    for (const member of membersToUpdate) {
      logger.info(`Fetching LinkedIn profile for ${member.name}...`);
      const profileData = await getLinkedInProfile(member.linkedin_url);
      if (profileData) {
        // Delete existing LinkedIn documents for this member
        await deleteLinkedInDocuments(member.id);

        // Create new LinkedIn RAG docs
        await createLinkedInDocuments(member.id, member.name, member.linkedin_url, profileData);
        logger.info(`Created/Updated LinkedIn documents for ${member.name}`);
      } else {
        logger.info(`Could not fetch LinkedIn profile for ${member.name} from ${member.linkedin_url}`);
      }
    }

    logger.info('LinkedIn profile sync completed');
  } finally {
    await closeDbConnection();
  }
}

export const updateLinkedinForOfficerndIdIfNeeded = async (officerndId: string): Promise<void> => {
  const membersWithLastUpdate = await getMembersWithLastLinkedInUpdates(officerndId);
  if (membersWithLastUpdate.length === 0) {
    logger.error(
      { officerndId },
      'Could not get last linkedin update for officerndId - member probably not inserted yet',
    );
    throw new Error('Could not get last linkedin update for officerndId - member probably not inserted yet');
  }

  const member = membersWithLastUpdate[0];
  const hasLinkedInUrl = member?.linkedin_url !== null;
  const neverUpdated = member?.last_linkedin_update === null;
  const stale = member?.last_linkedin_update && needsLinkedInUpdate(member.last_linkedin_update);

  const shouldUpdate = hasLinkedInUrl && (neverUpdated || stale);

  if (!shouldUpdate) {
    logger.info({ membersWithLastUpdate, officerndId }, 'No LinkedIn update needed');
    return;
  }

  const profileData = await getLinkedInProfile(member.linkedin_url as string);
  if (profileData) {
    await createLinkedInDocuments(officerndId, member.name, member.linkedin_url as string, profileData);
  }
};

const isValidNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isValidOption = (value: unknown): value is number | undefined => value === undefined || isValidNumber(value);

/**
 * Handle missing or invalid sync option overrides:
 *  - if provided and invalid, fail fast
 *  - if provided and valid, use those
 *  - if not provided, fall back to default values
 */
export const getValidSyncOptions = (syncOptionOverrides?: LinkedInSyncOptionOverrides): LinkedInSyncOptions => {
  const maxUpdates = syncOptionOverrides?.maxUpdates;
  const allowedAgeDays = syncOptionOverrides?.allowedAgeDays;

  if (!isValidOption(maxUpdates) || !isValidOption(allowedAgeDays)) {
    throw new Error(`Invalid sync option: maxUpdates: ${maxUpdates}, allowedAgeDays: ${allowedAgeDays}`);
  }

  return {
    maxUpdates: maxUpdates != null ? maxUpdates : DEFAULT_MAX_UPDATES,
    allowedAgeDays: allowedAgeDays != null ? allowedAgeDays : DEFAULT_LINKEDIN_PROFLE_ALLOWED_AGE_DAYS,
  };
};

/**
 * Get members that need LinkedIn updates, prioritizing those without data
 * @param members - Array of members with their metadata
 * @param maxUpdates - Maximum number of profiles to update (updates cost 1 proxycurl credit each, around 2 cents per credit)
 * @param allowedAgeDays - Linkedin profile data won't be updated until this many days after the last update
 * @returns Array of members that need updates, limited to maxUpdates
 */
export function getMembersToUpdate(
  members: MemberWithLinkedInUpdateMetadata[],
  maxUpdates = DEFAULT_MAX_UPDATES,
  allowedAgeDays = DEFAULT_LINKEDIN_PROFLE_ALLOWED_AGE_DAYS,
): MemberWithLinkedInUpdateMetadataAndUrl[] {
  const now = Date.now();
  const minimumUpdateAge = allowedAgeDays * MILLISECONDS_PER_DAY;
  const cutoffTime = now - minimumUpdateAge;

  // Filter members down to:
  //  - members for whom we have a LinkedIn url
  //  - members who actually need updates (last update is before cutoff time)
  const filteredMembers = members
    .filter((member): member is MemberWithLinkedInUpdateMetadataAndUrl => member.linkedin_url !== null)
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

const LINKEDIN_SOURCE_TYPE_PREFIX = 'linkedin_';

async function deleteLinkedInDocuments(officerndMemberId: string): Promise<void> {
  return deleteTypedDocumentsForMember(officerndMemberId, LINKEDIN_SOURCE_TYPE_PREFIX);
}

/**
 * Create LinkedIn documents for a member
 * @param officerndMemberId - The OfficeRnD member ID
 * @param memberName - The member's name
 * @param linkedinUrl - The member's LinkedIn URL
 * @param profile - The LinkedIn profile data
 */
export async function createLinkedInDocuments(
  officerndMemberId: string,
  memberName: string,
  linkedinUrl: string,
  profile: ProxycurlProfile,
): Promise<void> {
  const baseMetadata = {
    member_name: memberName,
    linkedin_url: linkedinUrl,
  };

  try {
    // Create headline document
    if (profile.headline) {
      const headlineId = `officernd_member_${officerndMemberId}:headline`;
      await insertOrUpdateDoc({
        source_type: `${LINKEDIN_SOURCE_TYPE_PREFIX}headline`,
        source_unique_id: headlineId,
        content: profile.headline,
        metadata: baseMetadata,
        embedding: null,
      });
    }

    // Create summary document
    if (profile.summary) {
      const summaryId = `officernd_member_${officerndMemberId}:summary`;
      await insertOrUpdateDoc({
        source_type: `${LINKEDIN_SOURCE_TYPE_PREFIX}summary`,
        source_unique_id: summaryId,
        content: profile.summary,
        metadata: baseMetadata,
        embedding: null,
      });
    }

    // Create experience documents
    for (const exp of profile.experiences) {
      const dateRange = formatDateRange(exp.starts_at, exp.ends_at);
      const content = [
        exp.title ? `${exp.title} at ${exp.company}` : exp.company,
        dateRange,
        exp.location,
        exp.description,
      ]
        .filter(Boolean)
        .join('\n');

      const experienceId = createExperienceId(exp.company, dateRange);
      const docId = `officernd_member_${officerndMemberId}:experience_${experienceId}`;
      const docMetadata = {
        ...baseMetadata,
        title: exp.title || null,
        company: exp.company,
        date_range: dateRange || null,
        location: exp.location || null,
      };

      await insertOrUpdateDoc({
        source_type: `${LINKEDIN_SOURCE_TYPE_PREFIX}experience`,
        source_unique_id: docId,
        content,
        metadata: docMetadata,
        embedding: null,
      });
    }

    // Create education documents
    for (const edu of profile.education) {
      const dateRange = formatDateRange(edu.starts_at, edu.ends_at);
      const content = [edu.school, edu.degree_name, edu.field_of_study, dateRange, edu.description]
        .filter(Boolean)
        .join('\n');

      const educationId = createEducationId(edu.school, edu.degree_name, edu.field_of_study, dateRange);
      const docId = `officernd_member_${officerndMemberId}:education_${educationId}`;
      const docMetadata = {
        ...baseMetadata,
        school: edu.school,
        degree_name: edu.degree_name || null,
        field_of_study: edu.field_of_study || null,
        date_range: dateRange || null,
      };

      await insertOrUpdateDoc({
        source_type: `${LINKEDIN_SOURCE_TYPE_PREFIX}education`,
        source_unique_id: docId,
        content,
        metadata: docMetadata,
        embedding: null,
      });
    }

    // Create skills document
    if (profile.skills.length > 0) {
      const content = profile.skills.join('\n');
      const skillsId = `officernd_member_${officerndMemberId}:skills`;
      const docMetadata = {
        ...baseMetadata,
        skills: profile.skills,
      };

      await insertOrUpdateDoc({
        source_type: `${LINKEDIN_SOURCE_TYPE_PREFIX}skills`,
        source_unique_id: skillsId,
        content,
        metadata: docMetadata,
        embedding: null,
      });
    }

    // Create languages document
    if (profile.languages.length > 0) {
      const content = profile.languages.join('\n');
      const languagesId = `officernd_member_${officerndMemberId}:languages`;

      await insertOrUpdateDoc({
        source_type: `${LINKEDIN_SOURCE_TYPE_PREFIX}languages`,
        source_unique_id: languagesId,
        content,
        metadata: baseMetadata,
        embedding: null,
      });
    }
  } catch (error) {
    logger.error('Error creating LinkedIn documents:', error);
    throw error;
  }
}

/**
 * Create a stable unique identifier for an experience
 * @param company - Company name
 * @param dateRange - Date range (optional)
 * @returns A stable unique identifier
 */
export function createExperienceId(company: string | null, dateRange?: string | null): string {
  // Handle null company name
  const companyName = company || 'unknown-company';
  // Create a URL-friendly version of the company name
  const companySlug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  // Use date range if available, otherwise use a hash of the company name
  const datePart = dateRange ? dateRange.replace(/[^a-z0-9-]+/g, '') : companySlug.slice(0, 8);
  return `${companySlug}-${datePart}`;
}

/**
 * Create a stable unique identifier for an education entry
 * @param school - School name
 * @param degree - Degree name
 * @param fieldOfStudy - Field of study
 * @param dateRange - Date range (optional)
 * @returns A stable unique identifier
 */
export function createEducationId(
  school: string | null,
  degree: string | null,
  fieldOfStudy: string | null,
  dateRange?: string | null,
): string {
  // Handle null school name
  const schoolName = school || 'unknown-school';
  // Create URL-friendly versions of the identifiers
  const schoolSlug = schoolName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const degreeSlug = degree?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || '';
  const fieldSlug = fieldOfStudy?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || '';
  const dateSlug = dateRange?.replace(/[^a-z0-9-]+/g, '') || '';

  // Combine the parts, using the most specific identifier available
  const parts = [schoolSlug];
  if (dateSlug) parts.push(dateSlug);
  else if (degreeSlug) parts.push(degreeSlug);
  else if (fieldSlug) parts.push(fieldSlug);
  else parts.push('unknown');

  return parts.join('-');
}

/**
 * Check if a LinkedIn profile needs updating based on last update time
 * @param lastUpdate - Last update timestamp in milliseconds
 * @param maxAge - Maximum age in milliseconds before update is needed
 * @returns boolean indicating if update is needed
 */
export function needsLinkedInUpdate(lastUpdate: number | null, maxAge: number = 90 * 24 * 60 * 60 * 1000): boolean {
  if (!lastUpdate) return true;
  const now = Date.now();
  return now - lastUpdate > maxAge;
}

/**
 * Format a date object into a string range
 * @param start - Start date object
 * @param end - End date object (can be null for current positions)
 * @returns Formatted date range string
 */
function formatDateRange(start: ProxycurlDateObject | null, end: ProxycurlDateObject | null): string | null {
  if (!start) return null;

  const startDate = `${start.year}-${String(start.month).padStart(2, '0')}-${String(start.day).padStart(2, '0')}`;
  if (!end) return `${startDate} - Present`;

  const endDate = `${end.year}-${String(end.month).padStart(2, '0')}-${String(end.day).padStart(2, '0')}`;
  return `${startDate} - ${endDate}`;
}
