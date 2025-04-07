import { config } from '../config';
import { deleteLinkedInDocuments, insertOrUpdateDoc } from './database';
import { logger } from './logger';

const PROXYCURL_API_URL = 'https://nubela.co/proxycurl/api/v2/linkedin';

interface DateObject {
  day: number;
  month: number;
  year: number;
}

export interface ProxycurlProfile {
  headline: string | null;
  summary: string | null;
  experiences: Array<{
    title: string | null;
    company: string;
    description: string | null;
    starts_at: DateObject | null;
    ends_at: DateObject | null;
    location: string | null;
    date_range?: string | null;
  }>;
  education: Array<{
    school: string;
    degree_name: string | null;
    field_of_study: string | null;
    starts_at: DateObject | null;
    ends_at: DateObject | null;
    description: string | null;
    date_range?: string | null;
  }>;
  skills: string[];
  languages: string[];
}

// Constants for time calculations
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 30;

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
function formatDateRange(start: DateObject | null, end: DateObject | null): string | null {
  if (!start) return null;

  const startDate = `${start.year}-${String(start.month).padStart(2, '0')}-${String(start.day).padStart(2, '0')}`;
  if (!end) return `${startDate} - Present`;

  const endDate = `${end.year}-${String(end.month).padStart(2, '0')}-${String(end.day).padStart(2, '0')}`;
  return `${startDate} - ${endDate}`;
}

/**
 * Fetches a LinkedIn profile using the Proxycurl API.
 * @param linkedinUrl - The URL of the LinkedIn profile.
 * @returns The parsed LinkedIn profile data, or null if not found or error occurs.
 */
export async function getLinkedInProfile(linkedinUrl: string): Promise<ProxycurlProfile | null> {
  const apiKey = config.proxycurlApiKey;

  if (!apiKey) {
    logger.error('Error: Proxycurl API key not configured');
    throw new Error('Proxycurl API key not configured');
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
  };

  try {
    const response = await fetch(`${PROXYCURL_API_URL}?url=${encodeURIComponent(linkedinUrl)}`, {
      headers,
    });

    if (response.status === 404) {
      logger.warn('LinkedIn profile not found:', { linkedinUrl });
      return null;
    }

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Proxycurl API error:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
        linkedinUrl,
      });
      // Consider specific error handling based on status codes if needed
      throw new Error(`Proxycurl API error: ${response.statusText}`);
    }

    return (await response.json()) as ProxycurlProfile;
  } catch (error) {
    logger.error('Error fetching LinkedIn profile:', { error, linkedinUrl });
    throw error; // Re-throw after logging
  }
}

/**
 * Create a stable unique identifier for an experience
 * @param company - Company name
 * @param dateRange - Date range (optional)
 * @returns A stable unique identifier
 */
function createExperienceId(company: string | null, dateRange?: string | null): string {
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
function createEducationId(
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
    // Delete existing LinkedIn documents for this member
    await deleteLinkedInDocuments(officerndMemberId);

    // Create headline document
    if (profile.headline) {
      const headlineId = `officernd_member_${officerndMemberId}:headline`;
      await insertOrUpdateDoc({
        source_type: 'linkedin_headline',
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
        source_type: 'linkedin_summary',
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
        source_type: 'linkedin_experience',
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
        source_type: 'linkedin_education',
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
        source_type: 'linkedin_skills',
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
        source_type: 'linkedin_languages',
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
 * Get members that need LinkedIn updates, prioritizing those without data
 * @param members - Array of members with their metadata
 * @param maxUpdates - Maximum number of updates to perform (default: 100)
 * @returns Array of members that need updates, limited to maxUpdates
 */
export function getMembersToUpdate(
  members: Array<{
    id: string;
    name: string;
    linkedin_url: string;
    metadata?: {
      last_linkedin_update?: number;
    };
  }>,
  maxUpdates = 100,
): Array<{ id: string; name: string; linkedin_url: string }> {
  const now = Date.now();
  const minimumUpdateAge = DAYS_PER_MONTH * MILLISECONDS_PER_DAY;
  const cutoffTime = now - minimumUpdateAge;

  // Sort members by priority:
  // 1. No LinkedIn data (no last_linkedin_update)
  // 2. Oldest updates first
  const sortedMembers = [...members].sort((a, b) => {
    const aUpdate = a.metadata?.last_linkedin_update;
    const bUpdate = b.metadata?.last_linkedin_update;

    // If neither has an update, maintain original order
    if (!aUpdate && !bUpdate) return 0;
    // If only one has an update, prioritize the one without
    if (!aUpdate) return -1;
    if (!bUpdate) return 1;
    // If both have updates, prioritize the older one
    return aUpdate - bUpdate;
  });

  // Filter members that need updates and limit to maxUpdates
  return sortedMembers
    .filter((member) => {
      const lastUpdate = member.metadata?.last_linkedin_update;
      return !lastUpdate || lastUpdate < cutoffTime;
    })
    .slice(0, maxUpdates)
    .map(({ id, name, linkedin_url }) => ({ id, name, linkedin_url }));
}
