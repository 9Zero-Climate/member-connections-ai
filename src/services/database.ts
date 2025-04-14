import { getPackedSettings } from 'node:http2';
import { Client } from 'pg';
import { config } from '../config'; // Import unified config
import { generateEmbeddings } from './embedding';
import { logger } from './logger';

export interface Document {
  source_type: string;
  source_unique_id: string;
  content: string;
  embedding: number[] | null;
  metadata?: Record<string, unknown>;
  created_at?: Date;
  updated_at?: Date;
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

export type QueryParams = (string | number | Record<string, unknown> | null)[];

let client: Client | TestClient;

function getClient(): Client | TestClient {
  if (client) return client;

  if (process.env.NODE_ENV === 'test') {
    // Use a mock client in test environment
    client = {
      query: jest.fn().mockImplementation((_query: string, _params?: QueryParams) => Promise.resolve({ rows: [] })),
      connect: jest.fn().mockImplementation(() => Promise.resolve()),
      end: jest.fn().mockImplementation(() => Promise.resolve()),
    };
  } else {
    // Use a real client in other environments
    client = new Client({
      connectionString: config.dbUrl, // Use config here
    });
    // Connect to the database
    client.connect().catch((err) => {
      logger.error('Failed to connect to database:', err);
      throw err;
    });
  }
  return client;
}

// Initialize client
client = getClient();

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
  try {
    // Generate embeddings if not provided
    const embedding = doc.embedding ?? (await generateEmbeddings([doc.content]))[0];
    const embeddingVector = formatForStorage(embedding);

    const result = await client.query(
      `INSERT INTO rag_docs (source_type, source_unique_id, content, embedding, metadata)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (source_unique_id) 
       DO UPDATE SET 
          updated_at = CURRENT_TIMESTAMP,
          source_type = EXCLUDED.source_type,
          content = EXCLUDED.content,
          embedding = EXCLUDED.embedding,
          metadata = EXCLUDED.metadata
       RETURNING *`,
      [doc.source_type, doc.source_unique_id, doc.content, embeddingVector, doc.metadata],
    );
    return result.rows[0];
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
 * @returns Similar documents with similarity scores
 */
async function findSimilar(embedding: number[], options: SearchOptions = {}): Promise<Document[]> {
  try {
    const embeddingVector = formatForComparison(embedding);
    const limit = options.limit || 5;
    const excludeEmbeddingsFromResults = options.excludeEmbeddingsFromResults;

    const result = await client.query(
      `SELECT
        source_type,
        source_unique_id,
        content,
        ${excludeEmbeddingsFromResults ? '' : 'embedding,'}
        metadata,
        created_at,
        updated_at,
        slack_user_id,
        1 - (embedding <=> $1) as similarity
      FROM documents_with_slack_user_id
      ORDER BY embedding <=> $1
      LIMIT $2`,
      [embeddingVector, limit],
    );

    // Convert stored vector format back to array for each result
    return result.rows.map((doc: Document & { slack_user_id: string | null }) => ({
      ...doc,
      ...(excludeEmbeddingsFromResults ? {} : { embedding: parseStoredEmbedding(doc.embedding as string | null) }),
      metadata: {
        ...doc.metadata,
        slack_user_id: doc.slack_user_id,
      },
    }));
  } catch (error) {
    logger.error('Error finding similar documents:', error);
    throw error;
  }
}

/**
 * Close the database connection
 */
async function close(): Promise<void> {
  try {
    await client.end();
  } catch (error) {
    logger.error('Error closing database connection:', error);
    throw error;
  }
}

// For testing
function setTestClient(testClient: TestClient): void {
  client = testClient;
}

/**
 * Bulk insert or update members
 * @param members - Array of members to insert/update
 * @returns The inserted/updated members
 */
async function bulkUpsertMembers(members: Member[]): Promise<Member[]> {
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
    return result.rows;
  } catch (error) {
    logger.error('Error bulk upserting members:', error);
    throw error;
  }
}

/**
 * Delete all LinkedIn documents for a member
 * @param officerndMemberId - OfficeRnD member ID
 */
async function deleteLinkedInDocuments(officerndMemberId: string): Promise<void> {
  try {
    await client.query(
      `DELETE FROM rag_docs 
       WHERE source_type LIKE 'linkedin_%' 
       AND source_unique_id LIKE 'officernd_member_${officerndMemberId}:%'`,
    );
  } catch (error) {
    logger.error('Error deleting LinkedIn documents:', error);
    throw error;
  }
}

/**
 * Get the last update times for multiple members LinkedIn documents in a single query
 * @returns Map of member IDs to their last update timestamps in milliseconds
 */
async function getLastLinkedInUpdates(): Promise<Map<string, number | null>> {
  try {
    const result = (await client.query(
      `SELECT 
         SUBSTRING(source_unique_id FROM 'officernd_member_(.+):') as member_id,
         MAX(created_at, updated_at) as last_update
       FROM rag_docs
       WHERE source_type LIKE 'linkedin_%'
       GROUP BY member_id`,
    )) as { rows: { member_id: string; last_update: string | null }[] };

    const updates = new Map<string, number | null>(
      result.rows.map((row) => [row.member_id, row.last_update ? new Date(row.last_update).getTime() : null]),
    );
    return updates;
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
  try {
    const result = await client.query(
      `SELECT * FROM documents_with_slack_user_id
       WHERE source_type LIKE 'linkedin_%' 
       AND metadata->>'linkedin_url' = $1`,
      [linkedinUrl],
    );
    return result.rows.map((row: Document & { slack_user_id: string | null }) => ({
      ...row,
      metadata: {
        ...row.metadata,
        slack_user_id: row.slack_user_id,
      },
    }));
  } catch (error) {
    logger.error('Error fetching LinkedIn documents:', error);
    throw error;
  }
}

/**
 * Get all LinkedIn documents for a given member name
 * @param memberName - The member's name
 * @returns Array of documents with their content and metadata
 */
async function getLinkedInDocumentsByName(memberName: string): Promise<Document[]> {
  try {
    const result = await client.query(
      `SELECT
        created_at,
        source_type,
        source_unique_id,
        content,
        updated_at,
        metadata,
        slack_user_id
       FROM documents_with_slack_user_id
       WHERE source_type LIKE 'linkedin_%' 
       AND metadata->>'member_name' = $1`,
      [memberName],
    );
    return result.rows.map((row: Document & { slack_user_id: string | null }) => ({
      ...row,
      metadata: {
        ...row.metadata,
        slack_user_id: row.slack_user_id,
      },
    }));
  } catch (error) {
    logger.error('Error fetching LinkedIn documents:', error);
    throw error;
  }
}

/**
 * Save feedback vote to the database
 * @param feedback - The feedback data to save
 * @returns The saved feedback record
 */
async function saveFeedback(feedback: FeedbackVote): Promise<FeedbackVote> {
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

export {
  insertOrUpdateDoc,
  getDocBySource,
  deleteDoc,
  findSimilar,
  close,
  getLastLinkedInUpdates,
  bulkUpsertMembers,
  deleteLinkedInDocuments,
  setTestClient,
  getLinkedInDocuments,
  getLinkedInDocumentsByName,
  saveFeedback,
};
