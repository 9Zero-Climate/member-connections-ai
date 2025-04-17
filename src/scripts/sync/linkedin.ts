import { getLastLinkedInUpdates, type Member } from '../../services/database';
import { logger } from '../../services/logger';
import {
  type ProxycurlProfile,
  createLinkedInDocuments,
  getLinkedInProfile,
  getMembersToUpdate,
} from '../../services/proxycurl';

interface MemberWithMeta {
  id: string;
  name: string;
  linkedin_url: string | null;
  metadata?: {
    last_linkedin_update?: number;
  };
}

/**
 * Sync data from LinkedIn. This is expensive, so we are careful to only fetch the data we really need
 * 1. Determine who needs updated LinkedIn data
 * 2. Fetch data from LinkedIn for those members
 * 3. Update the Members table, and replace all LinkedIn RAG docs for to this member
 */
export async function syncLinkedIn(dbMembers: Member[], maxUpdates: number, allowedAgeDays: number): Promise<void> {
  logger.info('Starting LinkedIn profile synchronization...');

  // Get last update times for LinkedIn docs
  logger.info('Fetching last LinkedIn update timestamps...');
  const lastUpdates = await getLastLinkedInUpdates();
  logger.info(`Found ${lastUpdates.size} members with existing LinkedIn documents.`);

  // Prepare list of members with metadata for update check
  const membersWithMeta: MemberWithMeta[] = dbMembers.map((m) => ({
    id: m.officernd_id,
    name: m.name,
    linkedin_url: m.linkedin_url,
    metadata: {
      last_linkedin_update: lastUpdates.get(m.officernd_id) || undefined,
    },
  }));

  // Filter members needing Linkedin profile updates
  const membersWithLinkedInUrl = membersWithMeta.filter(
    (m): m is MemberWithMeta & { linkedin_url: string } => m.linkedin_url !== null,
  );
  const membersToUpdate = getMembersToUpdate(membersWithLinkedInUrl, maxUpdates, allowedAgeDays);
  logger.info(
    `Identified ${membersToUpdate.length} members needing LinkedIn updates (max: ${maxUpdates}, age: ${allowedAgeDays} days).`,
  );

  // Process updates
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
}
