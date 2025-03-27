const { Client } = require('pg');
const { config } = require('dotenv');

// Load environment variables
config();

// Debug logging
console.log('Database URL:', process.env.DB_URL ? 'Present' : 'Missing');

let client;

function getClient() {
  if (client) return client;

  if (process.env.NODE_ENV === 'test') {
    client = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      connect: jest.fn().mockResolvedValue(),
      end: jest.fn().mockResolvedValue(),
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
 * Format embedding for database storage
 * @param {number[]|string} embedding - The embedding vector or JSON string
 * @returns {string} Formatted embedding for database
 */
function formatEmbedding(embedding) {
  if (!embedding) return null;
  if (typeof embedding === 'string') return embedding;
  return JSON.stringify(embedding);
}

/**
 * Insert a document into the database
 * @param {Object} doc - The document to insert
 * @returns {Promise<Object>} The inserted document
 */
async function insertDoc(doc) {
  try {
    const embeddingVector = formatEmbedding(doc.embedding);
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
 * @param {string} sourceUniqueId - The unique ID of the document
 * @returns {Promise<Object|null>} The document or null if not found
 */
async function getDocBySource(sourceUniqueId) {
  try {
    const result = await client.query('SELECT * FROM rag_docs WHERE source_unique_id = $1', [sourceUniqueId]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting document:', error);
    throw error;
  }
}

/**
 * Update a document's content and embedding
 * @param {string} sourceUniqueId - The unique ID of the document
 * @param {Object} updates - The updates to apply
 * @returns {Promise<Object>} The updated document
 */
async function updateDoc(sourceUniqueId, updates) {
  try {
    const embeddingVector = formatEmbedding(updates.embedding);
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
 * @param {string} sourceUniqueId - The unique ID of the document
 * @returns {Promise<boolean>} True if deleted, false if not found
 */
async function deleteDoc(sourceUniqueId) {
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
 * @param {number[]} embedding - The embedding vector to compare against
 * @param {Object} options - Search options
 * @param {number} options.limit - Maximum number of results to return
 * @returns {Promise<Object[]>} Similar documents with similarity scores
 */
async function findSimilar(embedding, options = {}) {
  try {
    const embeddingVector = formatEmbedding(embedding);
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
    return result.rows;
  } catch (error) {
    console.error('Error finding similar documents:', error);
    throw error;
  }
}

/**
 * Close the database connection
 */
async function close() {
  try {
    await client.end();
  } catch (error) {
    console.error('Error closing database connection:', error);
    throw error;
  }
}

// For testing
function setTestClient(testClient) {
  client = testClient;
}

module.exports = {
  insertDoc,
  getDocBySource,
  updateDoc,
  deleteDoc,
  findSimilar,
  close,
  setTestClient, // Export for testing
};
