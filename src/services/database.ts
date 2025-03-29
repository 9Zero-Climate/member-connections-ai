import { config } from 'dotenv';
import { Client } from 'pg';

// Load environment variables
config();

// Debug logging
console.log('Database URL:', process.env.DB_URL ? 'Present' : 'Missing');

export interface Document {
  source_type: string;
  source_unique_id: string;
  content: string;
  embedding: number[] | null;
  metadata?: Record<string, unknown>;
  created_at?: Date;
  updated_at?: Date;
}

interface DocumentUpdate {
  content?: string;
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

export interface SearchOptions {
  limit?: number;
}

export interface TestClient {
  query: jest.Mock;
  connect: jest.Mock;
  end: jest.Mock;
}

type QueryParams = (string | number | Record<string, unknown> | null)[];

let client: Client | TestClient;

function getClient(): Client | TestClient {
  if (client) return client;

  if (process.env.NODE_ENV === 'test') {
    client = {
      query: jest.fn().mockImplementation((query: string, params?: QueryParams) => Promise.resolve({ rows: [] })),
      connect: jest.fn().mockImplementation(() => Promise.resolve()),
      end: jest.fn().mockImplementation(() => Promise.resolve()),
    };
  } else {
    client = new Client({
      connectionString: process.env.DB_URL,
    });
    // Connect to the database
    client.connect().catch((err) => {
      console.error('Failed to connect to database:', err);
      process.exit(1);
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
 * Insert a document into the database
 * @param doc - The document to insert
 * @returns The inserted document
 */
async function insertDoc(doc: Document): Promise<Document> {
  try {
    const embeddingVector = formatForStorage(doc.embedding);
    const result = await client.query(
      'INSERT INTO rag_docs (source_type, source_unique_id, content, embedding, metadata) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [doc.source_type, doc.source_unique_id, doc.content, embeddingVector, doc.metadata],
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error inserting document:', error);
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
    console.error('Error getting document:', error);
    throw error;
  }
}

/**
 * Update a document's content and embedding
 * @param sourceUniqueId - The unique ID of the document
 * @param updates - The updates to apply
 * @returns The updated document
 */
async function updateDoc(sourceUniqueId: string, updates: DocumentUpdate): Promise<Document> {
  try {
    const embeddingVector = formatForStorage(updates.embedding || null);
    const result = await client.query(
      'UPDATE rag_docs SET content = $1, embedding = $2, metadata = $3 WHERE source_unique_id = $4 RETURNING *',
      [updates.content, embeddingVector, updates.metadata, sourceUniqueId],
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error updating document:', error);
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
    console.error('Error deleting document:', error);
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

    const result = await client.query(
      `SELECT
        source_type,
        source_unique_id,
        content,
        embedding,
        metadata,
        created_at,
        updated_at,
        1 - (embedding <=> $1) as similarity
      FROM rag_docs
      ORDER BY embedding <=> $1
      LIMIT $2`,
      [embeddingVector, limit],
    );

    // Convert stored vector format back to array for each result
    return result.rows.map((doc: Document) => ({
      ...doc,
      embedding: parseStoredEmbedding(doc.embedding as string | null),
    }));
  } catch (error) {
    console.error('Error finding similar documents:', error);
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
    console.error('Error closing database connection:', error);
    throw error;
  }
}

// For testing
function setTestClient(testClient: TestClient): void {
  client = testClient;
}

export {
  insertDoc,
  getDocBySource,
  updateDoc,
  deleteDoc,
  findSimilar,
  close,
  setTestClient, // Export for testing
};
