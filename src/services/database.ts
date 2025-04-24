import { getPackedSettings } from 'node:http2';
import { Client } from 'pg';
import { config } from '../config'; // Import unified config
import { generateEmbeddings } from './embedding';
import { logger } from './logger';
import type { NotionMemberData } from './notion'; // Import Notion data type

export interface Document {
  source_type: string;
  source_unique_id: string;
  content: string;
  embedding?: number[] | null;
  metadata?: Record<string, unknown>;
  created_at?: Date;
  updated_at?: Date;
}

export interface DocumentWithMemberContext extends Document {
  member_name: string | null;
  member_slack_id: string | null;
  member_location_tags: string[] | null;
  member_linkedin_url: string | null;
  member_notion_page_url: string | null;
}

export interface SearchOptions {
  limit?: number;
  excludeEmbeddingsFromResults?: boolean;
}

export interface TestClient {
  query: jest.Mock;
  connect: jest.Mock;
  end: jest.Mock;
}

export interface Member {
  officernd_id: string;
  name: string;
  slack_id: string | null;
  linkedin_url: string | null;
  notion_page_id: string | null;
  notion_page_url: string | null;
  location_tags: string[] | null;
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

// For testing
function setClient(client: Client): void {
  globalClient = client;
}

function unsetClient(): void {
  globalClient = undefined;
}

async function getOrCreateClient(): Promise<Client> {
  if (globalClient) return globalClient;

  if (process.env.NODE_ENV === 'test') {
    throw new Error(`Don't try connecting to real db in tests! This global client should be set by test setup`);
  }

  try {
    logger.info('Opening new global database connection');
    globalClient = new Client({ connectionString: config.dbUrl });
    await globalClient.connect();
  } catch (error) {
    logger.error('Failed to connect to database:', error);
    throw error;
  }

  return globalClient;
}

async function closeDbConnection(): Promise<void> {
  if (globalClient === undefined) {
    logger.error("Trying to close global database connection but it doesn't exist");
  } else {
    await globalClient.end();
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
    logger.error('Error inserting/updating document:', error);
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
    logger.error('Error getting document:', error);
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
    logger.error('Error deleting document:', error);
    throw error;
  }
}

/**
 * Find similar documents using vector similarity
 * @param embedding - The embedding vector to compare against
 * @param options - Search options
 * @returns Similar documents with similarity scores and member context
 */
async function findSimilar(embedding: number[], options: SearchOptions = {}): Promise<Document[]> {
  const client = await getOrCreateClient();

  try {
    const embeddingVector = formatForComparison(embedding);
    const limit = options.limit || 5;
    const excludeEmbeddingsFromResults = options.excludeEmbeddingsFromResults ?? true; // Default to excluding embeddings

    // Note we're not just direct querying the `rag_docs` table,
    // we're querying the view that includes member context
    const result = await client.query(
      `SELECT
        source_type,
        source_unique_id,
        content,
        ${excludeEmbeddingsFromResults ? '' : 'embedding,'}
        metadata,
        created_at,
        updated_at,
        member_name,
        member_slack_id,
        member_location_tags,
        member_linkedin_url,
        member_notion_page_url,
        1 - (embedding <=> $1) as similarity
      FROM documents_with_member_context
      ORDER BY embedding <=> $1
      LIMIT $2`,
      [embeddingVector, limit],
    );

    // Enhance metadata with member context from the view
    return result.rows.map(
      (
        row: Document & {
          member_name: string | null;
          member_slack_id: string | null;
          member_location_tags: string[] | null;
          member_linkedin_url: string | null;
          member_notion_page_url: string | null;
        },
      ) => {
        // Extract the fields we want to keep
        const {
          source_type,
          source_unique_id,
          content,
          metadata,
          created_at,
          updated_at,
          member_name,
          member_slack_id,
          member_location_tags,
          member_linkedin_url,
          member_notion_page_url,
          embedding: rawEmbedding,
        } = row;

        return {
          source_type,
          source_unique_id,
          content,
          created_at,
          updated_at,
          // Only include embedding if requested
          ...(excludeEmbeddingsFromResults
            ? {}
            : {
                embedding: parseStoredEmbedding(rawEmbedding as string | null),
              }),
          // Merge member context into metadata
          metadata: {
            ...metadata,
            member_name,
            member_slack_id,
            member_location_tags,
            member_linkedin_url,
            member_notion_page_url,
          },
        };
      },
    );
  } catch (error) {
    logger.error('Error finding similar documents:', error);
    throw error;
  }
}

/**
 * Bulk insert or update members
 * @param members - Array of members to insert/update
 * @returns The inserted/updated members
 */
async function bulkUpsertMembers(members: Partial<Member>[]): Promise<Member[]> {
  logger.info('Upserting basic member info into database...');
  const client = await getOrCreateClient();

  if (members.length === 0) return [];

  try {
    const result = await client.query(
      `INSERT INTO members (officernd_id, name, slack_id, linkedin_url)
       SELECT unnest($1::text[]), unnest($2::text[]), unnest($3::text[]), unnest($4::text[])
       ON CONFLICT (officernd_id)
       DO UPDATE SET
         name = EXCLUDED.name,
         slack_id = EXCLUDED.slack_id,
         linkedin_url = EXCLUDED.linkedin_url,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        members.map((m) => m.officernd_id),
        members.map((m) => m.name),
        members.map((m) => m.slack_id),
        members.map((m) => m.linkedin_url),
      ],
    );
    logger.info(`Upserted ${members.length} members into the database.`);
    return result.rows;
  } catch (error) {
    logger.error('Error bulk upserting members:', error);
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
    logger.error(`Error deleting ${typePrefix} documents for member ${officerndMemberId}:`, error);
    throw error;
  }
}

// Specific deletion functions for clarity
async function deleteLinkedInDocuments(officerndMemberId: string): Promise<void> {
  return deleteTypedDocumentsForMember(officerndMemberId, 'linkedin_');
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
 * @returns List of members
 */
async function getMembersWithLastLinkedInUpdates(): Promise<MemberWithLinkedInUpdateMetadata[]> {
  logger.info('Fetching Members with last LinkedIn update metadata...');
  const client = await getOrCreateClient();

  try {
    const result = await client.query(`
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
      LEFT JOIN linked_in_last_updates_by_member on linked_in_last_updates_by_member.member_id = members.officernd_id;
    `);

    const members: MemberWithLinkedInUpdateMetadata[] = result.rows;

    logger.info(`Fetched ${members.length} members`);
    return members;
  } catch (error) {
    logger.error('Error getting last LinkedIn updates:', error);
    throw error;
  }
}

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
    return result.rows.map((row: DocumentWithMemberContext) => ({
      ...row,
      metadata: {
        ...row.metadata,
        member_name: row.member_name,
        member_slack_id: row.member_slack_id,
        member_location_tags: row.member_location_tags,
      },
    }));
  } catch (error) {
    logger.error('Error fetching LinkedIn documents by URL:', error);
    throw error;
  }
}

/**
 * Get all LinkedIn documents for a given member name
 * @param memberName - The member's name
 * @returns Array of documents with their content and metadata
 */
async function getLinkedInDocumentsByName(memberName: string): Promise<DocumentWithMemberContext[]> {
  const client = await getOrCreateClient();

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
        member_location_tags,
        member_notion_page_url,
        member_officernd_id,
        member_slack_id
       FROM documents_with_member_context -- Use the enriched view
       WHERE source_type LIKE 'linkedin_%'
       AND metadata->>'member_name' = $1`,
      [memberName],
    );
    // Map results, ensuring metadata includes view fields
    return result.rows.map((row: DocumentWithMemberContext) => ({
      ...row,
      metadata: {
        ...row.metadata,
        member_name: row.member_name, // Already present via metadata key, but good to be explicit
        member_slack_id: row.member_slack_id,
        member_location_tags: row.member_location_tags,
        member_notion_page_url: row.member_notion_page_url,
        member_linkedin_url: row.member_linkedin_url,
      },
    }));
  } catch (error) {
    logger.error('Error fetching LinkedIn documents by Name:', error);
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
    logger.error('Error saving feedback vote:', error);
    throw error; // Re-throw the error to be handled by the caller
  }
}

async function updateMemberWithNotionData(officerndMemberId: string, notionData: NotionMemberData): Promise<void> {
  const client = await getOrCreateClient();

  await client.query(
    `
    UPDATE members
    SET 
      notion_page_id = $1, 
      location_tags = $2, 
      notion_page_url = $3, 
      linkedin_url = COALESCE($4, linkedin_url), -- Don't overwrite with null
      updated_at = CURRENT_TIMESTAMP
    WHERE officernd_id = $5
    `,
    [
      notionData.notionPageId,
      notionData.locationTags.length > 0 ? notionData.locationTags : null,
      notionData.notionPageUrl,
      notionData.linkedinUrl,
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

export {
  getOrCreateClient,
  setClient,
  unsetClient,
  insertOrUpdateDoc,
  getDocBySource,
  deleteDoc,
  findSimilar,
  closeDbConnection,
  getMembersWithLastLinkedInUpdates,
  bulkUpsertMembers,
  deleteLinkedInDocuments,
  deleteNotionDocuments,
  getLinkedInDocuments,
  getLinkedInDocumentsByName,
  saveFeedback,
  upsertNotionDataForMember,
  updateMembersFromNotion,
};
