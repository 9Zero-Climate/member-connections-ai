import { Client, type QueryResult } from 'pg';
import { config } from '../config';
import { DEFAULT_LINKEDIN_PROFLE_ALLOWED_AGE_DAYS } from '../sync/linkedin_constants';
import { generateEmbeddings } from './embedding';
import { normalizeLinkedInUrl, normalizeLinkedinUrlOrNull } from './linkedin';
import { logger } from './logger';
import type { NotionMemberData } from './notion';

export interface Document {
  source_type: string;
  source_unique_id: string;
  content: string;
  embedding?: number[] | null;
  metadata?: Record<string, unknown>;
  created_at?: Date;
  updated_at?: Date;
}

export interface DocumentWithMemberContextAndSimilarity extends Document {
  member_name: string | null;
  member_slack_id: string | null;
  member_location: OfficeLocation | null;
  member_checkin_location_today: OfficeLocation | null;
  member_is_checked_in_today: boolean;
  member_linkedin_url: string | null;
  member_notion_page_url: string | null;
  member_officernd_id: string;
  similarity: number;
}
const DEFAULT_SEARCH_LIMIT = 20;
export type SearchOptions = {
  limit?: number;
  excludeEmbeddingsFromResults?: boolean;
  memberLocation?: OfficeLocation;
  memberCheckedInOnly?: boolean;
};

export type TestClient = {
  query: jest.Mock;
  connect: jest.Mock;
  end: jest.Mock;
};

export enum OfficeLocation {
  SEATTLE = 'Seattle',
  SAN_FRANCISCO = 'San Francisco',
}

export interface Member {
  officernd_id: string;
  name: string;
  slack_id: string | null;
  linkedin_url: string | null;
  notion_page_id: string | null;
  notion_page_url: string | null;
  location: OfficeLocation | null;
  checkin_location_today: OfficeLocation | null;
  created_at?: Date;
  updated_at?: Date;
}

// Define the structure for the feedback data
export interface FeedbackVote {
  message_channel_id: string;
  message_ts: string;
  submitted_by_user_id: string;
  reaction: string;
  reasoning: string;
  // Optional: original_message_user_id?: string;
  created_at?: Date;
}

export type QueryParams = (string | number | boolean | string[] | Record<string, unknown> | null)[];

let globalClient: Client | undefined;

async function getOrCreateClient(): Promise<Client> {
  if (globalClient) return globalClient;

  if (process.env.NODE_ENV === 'test' && process.env.DB_URL?.includes('supabase.com')) {
    throw new Error(`Don't try connecting to real db in tests! Test setup should set DB_URL to point to test db`);
  }

  try {
    logger.info('Opening new global database connection');
    globalClient = new Client({ connectionString: config.dbUrl });
    await globalClient.connect();
  } catch (error) {
    logger.warn(error, 'Failed to connect to database');
    throw error;
  }

  return globalClient;
}

async function checkDbConnection(): Promise<void> {
  const client = await getOrCreateClient();
  await client.query('SELECT 1');
}

async function closeDbConnection(): Promise<void> {
  if (globalClient === undefined) {
    logger.warn("Trying to close global database connection but it doesn't exist");
  } else {
    await globalClient.end();
    globalClient = undefined;
    logger.info('Global database connection closed.');
  }
}

/**
 * Parse a stored embedding from the database
 * @param storedEmbedding - The stored embedding string or array
 * @returns Parsed embedding vector or null
 */
function parseStoredEmbedding(storedEmbedding: string | number[] | null): number[] | null {
  if (!storedEmbedding) return null;
  if (Array.isArray(storedEmbedding)) return storedEmbedding;
  // Remove the [ and ] and split by comma
  return storedEmbedding.slice(1, -1).split(',').map(Number);
}

/**
 * Format an embedding for database storage
 * @param embedding - The embedding vector or JSON string
 * @returns PostgreSQL vector format string
 */
function formatForStorage(embedding: number[] | string | null): string | null {
  if (!embedding) return null;
  if (Array.isArray(embedding)) {
    // PostgreSQL vector format: [1,2,3]
    return `[${embedding.join(',')}]`;
  }
  if (typeof embedding === 'string') {
    // If it's already a string, ensure it's in the right format
    return embedding.startsWith('[') ? embedding : `[${embedding}]`;
  }
  return null;
}

/**
 * Format an embedding for vector similarity comparison
 * @param embedding - The embedding vector or JSON string
 * @returns PostgreSQL vector format string
 */
function formatForComparison(embedding: number[] | string | null): string | null {
  if (!embedding) return null;
  if (Array.isArray(embedding)) {
    // PostgreSQL vector format: [1,2,3]
    return `[${embedding.join(',')}]`;
  }
  if (typeof embedding === 'string') {
    // If it's already a string, ensure it's in the right format
    return embedding.startsWith('[') ? embedding : `[${embedding}]`;
  }
  return null;
}

/**
 * Insert or update a document in the database, generating embeddings if not provided
 * @param doc - The document to insert or update. The source_unique_id is used to determine if the document already exists.
 * @returns The inserted/updated document
 */
async function insertOrUpdateDoc(doc: Document): Promise<Document> {
  const client = await await getOrCreateClient();

  try {
    // Generate embeddings if not provided
    const embedding = doc.embedding ?? (await generateEmbeddings([doc.content]))[0];
    const embeddingVector = formatForStorage(embedding);

    const result = await client.query(
      `INSERT INTO rag_docs (updated_at, source_type, source_unique_id, content, embedding, metadata)
       VALUES (CURRENT_TIMESTAMP, $1, $2, $3, $4, $5)
       ON CONFLICT (source_unique_id)
       DO UPDATE SET
          updated_at = EXCLUDED.updated_at,
          source_type = EXCLUDED.source_type,
          content = EXCLUDED.content,
          embedding = EXCLUDED.embedding,
          metadata = EXCLUDED.metadata
       RETURNING *`,
      [doc.source_type, doc.source_unique_id, doc.content, embeddingVector, doc.metadata],
    );
    // Parse embedding before returning
    const returnedDoc = result.rows[0];
    returnedDoc.embedding = parseStoredEmbedding(returnedDoc.embedding as string | null);
    return returnedDoc;
  } catch (error) {
    logger.warn(error, 'Error inserting/updating document');
    throw error;
  }
}

/**
 * Get a document by its source unique ID
 * @param sourceUniqueId - The unique ID of the document
 * @returns The document or null if not found
 */
async function getDocBySource(sourceUniqueId: string): Promise<Document | null> {
  const client = await getOrCreateClient();

  try {
    const result = await client.query('SELECT * FROM rag_docs WHERE source_unique_id = $1', [sourceUniqueId]);
    if (!result.rows[0]) return null;

    // Convert stored vector format back to array
    const doc = result.rows[0];
    doc.embedding = parseStoredEmbedding(doc.embedding as string | null);
    return doc;
  } catch (error) {
    logger.warn(error, 'Error getting document:');
    throw error;
  }
}

/**
 * Delete a document
 * @param sourceUniqueId - The unique ID of the document
 * @returns True if deleted, false if not found
 */
async function deleteDoc(sourceUniqueId: string): Promise<boolean> {
  const client = await getOrCreateClient();

  try {
    const result = await client.query('DELETE FROM rag_docs WHERE source_unique_id = $1 RETURNING *', [sourceUniqueId]);
    return result.rows.length > 0;
  } catch (error) {
    logger.warn(error, 'Error deleting document');
    throw error;
  }
}

/**
 * Find similar documents using vector similarity
 * @param embedding - The embedding vector to compare against
 * @param options - Search options
 * @returns Similar documents with similarity scores and member context
 */
async function findSimilar(
  embedding: number[],
  options: SearchOptions = {},
): Promise<DocumentWithMemberContextAndSimilarity[]> {
  const client = await getOrCreateClient();

  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
  const excludeEmbeddingsFromResults = options.excludeEmbeddingsFromResults ?? true; // Default to excluding embeddings
  const memberLocation = options.memberLocation ?? null;
  const filterByMemberLocation = memberLocation != null;
  const memberCheckedInOnly = options.memberCheckedInOnly ?? false;

  try {
    const embeddingVector = formatForComparison(embedding);

    const queryParams: unknown[] = [
      embeddingVector, // 1st param: refer to as $1 in sql query
      limit ?? DEFAULT_SEARCH_LIMIT, // $2
    ];
    let filterQuery = '1 = 1 -- placeholder to make the query valid when no filters applied\n';
    if (filterByMemberLocation) {
      queryParams.push(memberLocation); // $3
      filterQuery += 'AND member_location = $3\n';
    }
    if (memberCheckedInOnly) {
      filterQuery += 'AND member_checkin_location_today IS NOT NULL\n';
    }
    const query = `SELECT
        source_type,
        source_unique_id,
        content,
        ${excludeEmbeddingsFromResults ? '' : 'embedding,'}
        metadata,
        created_at,
        updated_at,
        member_name,
        member_slack_id,
        member_location,
        member_checkin_location_today,
        member_linkedin_url,
        member_notion_page_url,
        member_officernd_id,
        1 - (embedding <=> $1) as similarity
      -- Note we're not just direct querying the rag_docs table,
      -- we're querying the view that includes member context
      FROM documents_with_member_context
      WHERE
        ${filterQuery}
      ORDER BY embedding <=> $1
      LIMIT $2`;

    const result: QueryResult<Omit<DocumentWithMemberContextAndSimilarity, 'member_is_checked_in_today'>> =
      await client.query(query, queryParams);

    return result.rows.map((row) => {
      const { embedding: rawEmbedding, ...rest } = row;

      return {
        member_is_checked_in_today: rest.member_checkin_location_today != null,
        ...(excludeEmbeddingsFromResults
          ? {}
          : {
              embedding: parseStoredEmbedding(rawEmbedding as string | null),
            }),
        ...rest,
      };
    });
  } catch (error) {
    logger.warn(error, 'Error finding similar documents');
    throw error;
  }
}

export async function getMemberFromSlackId(slackId: string): Promise<Member | null> {
  const client = await getOrCreateClient();
  const result = await client.query('SELECT * from members WHERE slack_id = $1', [slackId]);
  logger.info({ result }, 'getMemberFromSlackId');
  return result.rows[0] || null;
}

export async function deleteMember(officerndId: string): Promise<void> {
  const client = await getOrCreateClient();
  await client.query('DELETE FROM members WHERE officernd_id = $1', [officerndId]);
}

async function updateMember(officerndId: string, updates: Partial<Member>): Promise<Member> {
  logger.info({ updates }, `Updating member with officerndId=${officerndId}...`);
  const client = await getOrCreateClient();

  // Fetch existing member
  const selectResult = await client.query('SELECT * from members WHERE officernd_id = $1', [officerndId]);
  if (selectResult.rows.length !== 1) {
    throw new Error(
      `Failed to update member with id: ${officerndId}. Expected exactly one member, found ${selectResult.rows.length} members`,
    );
  }
  const memberToUpdate = selectResult.rows[0];

  // Merge with fields to update
  const memberWithUpdates = {
    ...memberToUpdate,
    ...updates,
  };

  // Insert back into db
  const updateResult = await client.query(
    `
      UPDATE members
      SET
        name = $2,
        slack_id = $3,
        linkedin_url = $4,
        location = $5,
        notion_page_id = $6,
        notion_page_url = $7,
        checkin_location_today = $8,
        updated_at = CURRENT_TIMESTAMP
      WHERE officernd_id = $1
      RETURNING *
    `,
    [
      officerndId,
      memberWithUpdates.name,
      memberWithUpdates.slack_id,
      memberWithUpdates.linkedin_url,
      memberWithUpdates.location,
      memberWithUpdates.notion_page_id,
      memberWithUpdates.notion_page_url,
      memberWithUpdates.checkin_location_today,
    ],
  );

  const updatedMember = updateResult.rows[0];

  logger.info({ updatedMember }, 'Updated');

  return updatedMember;
}

export type BasicMemberForUpsert = Pick<Member, 'officernd_id' | 'name' | 'slack_id' | 'linkedin_url' | 'location'>;

/**
 * Bulk insert or update members
 * @param members - Array of members to insert/update
 * @returns The inserted/updated members
 */
async function bulkUpsertMembers(members: BasicMemberForUpsert[]): Promise<Member[]> {
  logger.info('Upserting basic member info into database...');
  const client = await getOrCreateClient();

  if (members.length === 0) return [];

  try {
    const result = await client.query(
      `INSERT INTO members (officernd_id, name, slack_id, linkedin_url, location)
       SELECT unnest($1::text[]), unnest($2::text[]), unnest($3::text[]), unnest($4::text[]), unnest($5::text[])
       ON CONFLICT (officernd_id)
       DO UPDATE SET
         name = EXCLUDED.name,
         slack_id = EXCLUDED.slack_id,
         linkedin_url = EXCLUDED.linkedin_url,
         location = EXCLUDED.location,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        members.map((m) => m.officernd_id),
        members.map((m) => m.name),
        members.map((m) => m.slack_id),
        members.map((m) => m.linkedin_url),
        members.map((m) => m.location),
      ],
    );
    logger.info(`Upserted ${members.length} members into the database.`);
    return result.rows;
  } catch (error) {
    logger.warn(error, 'Error bulk upserting members');
    throw error;
  }
}

/**
 * Delete all RAG documents of a specific type prefix for a member
 * @param officerndMemberId - OfficeRnD member ID
 * @param typePrefix - e.g., 'linkedin_' or 'notion_'
 */
async function deleteTypedDocumentsForMember(officerndMemberId: string, typePrefix: string): Promise<void> {
  const client = await getOrCreateClient();

  try {
    const pattern = `${typePrefix}%`; // e.g., notion_%
    // Attempt to extract member ID from metadata first, then fallback to source_unique_id parsing
    // This requires consistent metadata structure.
    await client.query(
      `DELETE FROM rag_docs
       WHERE source_type LIKE $1
       AND (
         metadata->>'officernd_member_id' = $2
         OR (
           metadata->>'officernd_member_id' IS NULL
           AND source_unique_id LIKE 'officernd_member_${officerndMemberId}:%'
          )
       )`,
      [pattern, officerndMemberId],
    );
    logger.debug(`Deleted ${typePrefix} documents for member ${officerndMemberId}`);
  } catch (error) {
    logger.warn(error, `Error deleting ${typePrefix} documents for member ${officerndMemberId}`);
    throw error;
  }
}

async function deleteNotionDocuments(officerndMemberId: string): Promise<void> {
  return deleteTypedDocumentsForMember(officerndMemberId, 'notion_');
}

export interface MemberWithLinkedInUpdateMetadata {
  id: string;
  name: string;
  linkedin_url: string | null;
  last_linkedin_update?: number;
}

/**
 * Get all members with their last LinkedIn documents update times in a single query
 * @param officerndId - Optional OfficeRnD ID to filter by. If not provided, all members will be returned.
 * @returns List of members
 */
const getMemberOrMembersWithLastLinkedInUpdates = async (
  officerndId?: string | null,
): Promise<MemberWithLinkedInUpdateMetadata[]> => {
  logger.info('Fetching Members with last LinkedIn update metadata...');
  const client = await getOrCreateClient();

  try {
    const result = await client.query(
      `
      WITH linked_in_last_updates_by_member as (
        SELECT
          member_id,
          MAX(last_update) as last_update
        FROM (
          SELECT
            -- Prioritize metadata, then parse source_unique_id
            COALESCE(metadata->>'officernd_member_id', SUBSTRING(source_unique_id FROM 'officernd_member_(.+):.*')) as member_id,
            GREATEST(created_at, updated_at) as last_update
          FROM rag_docs
          WHERE source_type LIKE 'linkedin_%'
        ) AS subquery
        WHERE member_id IS NOT NULL -- Ensure we have a member ID
        GROUP BY member_id
      )
      SELECT 
        officernd_id as id,
        name,
        linkedin_url,
        linked_in_last_updates_by_member.last_update as last_linkedin_update
      FROM members
      LEFT JOIN linked_in_last_updates_by_member on linked_in_last_updates_by_member.member_id = members.officernd_id
      ${officerndId ? 'WHERE members.officernd_id = $1' : ''}
    `,
      officerndId ? [officerndId] : [],
    );

    const members: MemberWithLinkedInUpdateMetadata[] = result.rows;

    logger.info(`Fetched ${members.length} members`);
    return members;
  } catch (error) {
    logger.warn(error, 'Error getting last LinkedIn updates');
    throw error;
  }
};

const getMembersWithLastLinkedInUpdates = async (): Promise<MemberWithLinkedInUpdateMetadata[]> => {
  return getMemberOrMembersWithLastLinkedInUpdates();
};

const getLastLinkedInUpdateForMember = async (officerndId: string): Promise<number | null> => {
  const members = await getMemberOrMembersWithLastLinkedInUpdates(officerndId);
  return members[0]?.last_linkedin_update || null;
};

const getMember = async (officerndId: string): Promise<Member> => {
  const client = await getOrCreateClient();
  const result = await client.query('SELECT * FROM members WHERE officernd_id = $1', [officerndId]);

  if (result.rows.length !== 1) {
    logger.warn({ result, officerndId }, `Expected 1 member, got ${result.rows.length} for officerndId`);
    throw new Error(`Expected 1 member, got ${result.rows.length} for officerndId=${officerndId}`);
  }
  return result.rows[0];
};

/**
 * Get all LinkedIn documents for a given LinkedIn URL
 * @param linkedinUrl - The LinkedIn profile URL
 * @returns Array of documents with their content and metadata
 */
async function getLinkedInDocuments(linkedinUrl: string): Promise<Document[]> {
  const client = await getOrCreateClient();

  try {
    // Query the view to get enriched metadata
    const result = await client.query(
      `SELECT *
       FROM documents_with_member_context -- Use the enriched view
       WHERE source_type LIKE 'linkedin_%'
       AND member_linkedin_url = $1`,
      [linkedinUrl],
    );
    // Map results, ensuring metadata includes view fields (already done by findSimilar's logic)
    return result.rows.map((row: DocumentWithMemberContextAndSimilarity) => ({
      ...row,
      metadata: {
        ...row.metadata,
        member_name: row.member_name,
        member_slack_id: row.member_slack_id,
        member_location: row.member_location,
      },
    }));
  } catch (error) {
    logger.warn(error, 'Error fetching LinkedIn documents by URL');
    throw error;
  }
}

export const deleteLinkedinDocumentsForOfficerndId = async (officerndMemberId: string): Promise<void> => {
  const client = await getOrCreateClient();
  const result = await client.query(
    `DELETE FROM rag_docs
      WHERE source_type LIKE 'linkedin_%'
      AND source_unique_id LIKE 'officernd_member_${officerndMemberId}:%'`,
  );
  const anyDeleted = result.rowCount && result.rowCount > 0;
  logger.debug(
    { result, officerndMemberId, anyDeleted },
    anyDeleted ? 'Deleted LinkedIn documents for member' : 'No LinkedIn documents found to delete for member',
  );
};

/**
 * Get all LinkedIn documents for a given member identifier. LLM-friendly.
 * @param memberIdentifier - The member's fullname, slackID, linkedin URL, or OfficeRnD ID
 * @returns Array of documents with their content and metadata
 */
async function getLinkedInDocumentsByMemberIdentifier(
  memberIdentifier: string,
): Promise<DocumentWithMemberContextAndSimilarity[]> {
  const client = await getOrCreateClient();
  // Since this function call is LLM-friendly, we can't assume that the memberIdentifier is normalized if it's a linkedin URL
  const normalizedLinkedInUrl = normalizeLinkedinUrlOrNull(memberIdentifier);
  // Don't try to query for a linkedin URL if we're not able to normalize it
  // If we tried to match with a null linkedin URL, it would match everything missing a linkedin URL
  const linkedinQueryClause = normalizedLinkedInUrl ? 'OR member_linkedin_url = $2' : '';
  const linkedinQueryParams = normalizedLinkedInUrl ? [normalizedLinkedInUrl] : [];

  try {
    const result = await client.query(
      `SELECT 
        created_at,
        source_type,
        source_unique_id,
        content,
        updated_at,
        metadata,
        member_name,
        member_location,
        member_notion_page_url,
        member_officernd_id,
        member_slack_id,
        member_linkedin_url
       FROM documents_with_member_context -- Use the enriched view
       WHERE source_type LIKE 'linkedin_%'
       AND (
         member_name = $1
         OR member_slack_id = $1
         OR member_officernd_id = $1
         ${linkedinQueryClause}
       )`,
      [memberIdentifier, ...linkedinQueryParams],
    );
    if (result.rows.length === 0) {
      throw new Error(
        `No synced LinkedIn profile found for the given identifier. New profiles are synced daily for new members in OfficeRnD, and existing members are updated at least every ${DEFAULT_LINKEDIN_PROFLE_ALLOWED_AGE_DAYS} days.`,
      );
    }
    // Map results, ensuring metadata includes view fields
    return result.rows;
  } catch (error) {
    logger.warn(error, 'Error fetching LinkedIn documents by Name');
    throw error;
  }
}

/**
 * Save feedback vote to the database
 * @param feedback - The feedback data to save
 * @returns The saved feedback record
 */
async function saveFeedback(feedback: FeedbackVote): Promise<FeedbackVote> {
  const client = await getOrCreateClient();

  try {
    const result = await client.query(
      `INSERT INTO feedback (message_channel_id, message_ts, submitted_by_user_id, reaction, reasoning, environment)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        feedback.message_channel_id,
        feedback.message_ts,
        feedback.submitted_by_user_id,
        feedback.reaction,
        feedback.reasoning,
        config.environment,
      ],
    );
    // We assert the type here because RETURNING * should give us back the full row including DB-generated columns
    return result.rows[0] as FeedbackVote;
  } catch (error) {
    logger.error(error, 'Error saving feedback vote');
    throw error; // Re-throw the error to be handled by the caller
  }
}

async function updateMemberWithNotionData(officerndMemberId: string, notionData: NotionMemberData): Promise<void> {
  const client = await getOrCreateClient();

  // Note: This query is intentionally *not* overwriting an existing linkedin_url
  // This is a bit of a hack to cover for the temporary period while we are switching from getting
  // linkedin_url from Notion to getting it from ORND. Until ORND is populated with linkedin urls,
  // we still want to populated it from Notion. However, we don't want the Notion version to overwrite
  // anything synced from ORND. This has the downside that we also won't get updates from Notion
  // TODO (https://github.com/9Zero-Climate/member-connections-ai/issues/91): remove Notion sync entirely
  await client.query(
    `
    UPDATE members
    SET 
      notion_page_id = $1, 
      notion_page_url = $2, 
      linkedin_url = COALESCE(linkedin_url, $3), -- Don't overwrite existing linkedin_url unless it's null
      updated_at = CURRENT_TIMESTAMP
    WHERE officernd_id = $4
    `,
    [
      notionData.notionPageId,
      notionData.notionPageUrl,
      notionData.linkedinUrl ? normalizeLinkedInUrl(notionData.linkedinUrl) : null,
      officerndMemberId,
    ],
  );
}

async function createNotionRagDocsForMember(officerndMemberId: string, notionData: NotionMemberData): Promise<void> {
  const baseMetadata = {
    officernd_member_id: officerndMemberId,
    notion_page_id: notionData.notionPageId,
    notion_page_url: notionData.notionPageUrl,
    member_name: notionData.name,
  };

  // Create expertise document
  if (notionData.expertiseTags.length > 0) {
    const expertiseId = `officernd_member_${officerndMemberId}:notion_expertise`;
    const content = `Expertise and interests: ${notionData.expertiseTags.join(', ')}`;
    await insertOrUpdateDoc({
      source_type: 'notion_expertise',
      source_unique_id: expertiseId,
      content,
      metadata: { ...baseMetadata, tags: notionData.expertiseTags },
      embedding: null, // Let insertOrUpdateDoc handle embedding generation
    });
  }

  // Create status document (combining hiring/looking)
  let statusContent = 'Status not specified.';
  if (notionData.hiring && notionData.lookingForWork) {
    statusContent = 'Currently hiring and open to work.';
  } else if (notionData.hiring) {
    statusContent = 'Currently hiring.';
  } else if (notionData.lookingForWork) {
    statusContent = 'Currently open to work.';
  }

  if (notionData.hiring || notionData.lookingForWork) {
    const statusId = `officernd_member_${officerndMemberId}:notion_status`;
    await insertOrUpdateDoc({
      source_type: 'notion_status',
      source_unique_id: statusId,
      content: statusContent,
      metadata: { ...baseMetadata, hiring: notionData.hiring, looking_for_work: notionData.lookingForWork },
      embedding: null,
    });
  }
}

/**
 * Upserts Notion data for a specific member.
 * Updates members table and manages RAG documents.
 * @param officerndMemberId - The OfficeRnD ID of the member.
 * @param notionData - Parsed data from Notion.
 */
async function upsertNotionDataForMember(officerndMemberId: string, notionData: NotionMemberData): Promise<void> {
  // 1. Update member row in members table
  await updateMemberWithNotionData(officerndMemberId, notionData);

  // 2. Replace all RAG docs relating to this member (delete existing & create new)
  await deleteNotionDocuments(officerndMemberId);
  await createNotionRagDocsForMember(officerndMemberId, notionData);

  logger.debug(`Upserted Notion data for member ${officerndMemberId}`);
}

/**
 * Fetches all members from the DB and Notion, matches them, and updates the DB.
 * @param notionMembers - Array of member data fetched from Notion.
 */
async function updateMembersFromNotion(notionMembers: NotionMemberData[]): Promise<void> {
  logger.info('Updating members in database with Notion data...');
  const client = await getOrCreateClient();

  // Fetch existing members from DB for matching
  const dbResult = await client.query('SELECT officernd_id, name, notion_page_id FROM members');
  const dbMembers = dbResult.rows as Pick<Member, 'officernd_id' | 'name' | 'notion_page_id'>[];

  // Create lookup maps for efficient matching
  const nameToIdMap = new Map<string, string>();
  const notionPageIdToIdMap = new Map<string, string>();
  for (const m of dbMembers) {
    if (m.name) nameToIdMap.set(m.name.toLowerCase(), m.officernd_id);
    if (m.notion_page_id) notionPageIdToIdMap.set(m.notion_page_id, m.officernd_id);
  }

  const startTime = Date.now();
  const totalCount = notionMembers.length;
  let matchedCount = 0;
  let unmatchedCount = 0;

  // Iterate through Notion members and attempt to match/update
  for (const notionMember of notionMembers) {
    const processedCount = matchedCount + unmatchedCount;
    const remainingCount = totalCount - processedCount;
    const elapsedTimeSeconds = (Date.now() - startTime) / 1000;
    const processedPerSecond = processedCount / elapsedTimeSeconds;
    const remainingTimeSeconds = remainingCount / processedPerSecond;
    logger.debug(
      {
        processed: processedCount,
        total: totalCount,
        elapsedTimeSeconds,
        remainingCount,
        remainingTime: remainingTimeSeconds,
        notionMember,
      },
      'Notion sync progress',
    );
    let officerndId: string | undefined = undefined;

    // Match first by notion_page_id
    if (notionMember.notionPageId) {
      officerndId = notionPageIdToIdMap.get(notionMember.notionPageId);
    }

    // If not found by Notion ID, try matching by Name (case-insensitive)
    if (!officerndId && notionMember.name) {
      officerndId = nameToIdMap.get(notionMember.name.toLowerCase());
    }

    if (officerndId) {
      // Found a match, upsert the data
      await upsertNotionDataForMember(officerndId, notionMember);
      matchedCount++;
    } else {
      // No match found
      logger.warn(`Could not match Notion member: ${notionMember.name} (ID: ${notionMember.notionPageId})`);
      unmatchedCount++;
    }
  }
  logger.info(`Finished updating database with Notion data. Matched: ${matchedCount}, Unmatched: ${unmatchedCount}`);
}

export interface OnboardingConfig {
  admin_user_slack_ids: string[];
  onboarding_message_content: string;
}

async function getOnboardingConfig(location: OfficeLocation): Promise<OnboardingConfig> {
  const client = await getOrCreateClient();
  const result = await client.query(
    'SELECT admin_user_slack_ids, onboarding_message_content FROM onboarding_config WHERE location = $1',
    [location],
  );
  if (result.rows.length === 0) {
    throw new Error(`No onboarding config found for location: ${location}`);
  }
  return result.rows[0] as OnboardingConfig;
}

export {
  getOrCreateClient,
  checkDbConnection,
  insertOrUpdateDoc,
  getDocBySource,
  deleteDoc,
  findSimilar,
  closeDbConnection,
  getLastLinkedInUpdateForMember,
  getMembersWithLastLinkedInUpdates,
  getMember,
  updateMember,
  bulkUpsertMembers,
  deleteTypedDocumentsForMember,
  deleteNotionDocuments,
  getLinkedInDocuments,
  getLinkedInDocumentsByMemberIdentifier,
  saveFeedback,
  upsertNotionDataForMember,
  updateMembersFromNotion,
  getOnboardingConfig,
};
