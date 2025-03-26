const { Pool } = require('pg');
const { config } = require('dotenv');

// Load environment variables
config();

// Debug logging
console.log('Database URL:', process.env.DB_URL ? 'Present' : 'Missing');
console.log('Environment loaded:', process.env.NODE_ENV || 'development');

const pool = new Pool({
    connectionString: process.env.DB_URL,
});

// Test the connection immediately
pool.connect((err, client, release) => {
    if (err) {
        console.error('Error connecting to the database:', err);
    } else {
        console.log('Successfully connected to database');
        release();
    }
});

/**
 * Basic CRUD operations for rag_docs table
 */
const database = {
    /**
     * Insert a new document into rag_docs
     * @param {Object} doc - Document to insert
     * @param {string} doc.source_type - Type of source (e.g., 'slack')
     * @param {string} doc.source_unique_id - Unique identifier for the source
     * @param {string} doc.content - Text content
     * @param {number[]} doc.embedding - Vector embedding
     * @returns {Promise<Object>} - Inserted document
     */
    async insertDoc(doc) {
        const { source_type, source_unique_id, content, embedding } = doc;
        const query = `
      INSERT INTO rag_docs (source_type, source_unique_id, content, embedding)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
        const result = await pool.query(query, [source_type, source_unique_id, content, embedding]);
        return result.rows[0];
    },

    /**
     * Get a document by its source identifiers
     * @param {string} source_type - Type of source
     * @param {string} source_unique_id - Unique identifier
     * @returns {Promise<Object|null>} - Found document or null
     */
    async getDocBySource(source_type, source_unique_id) {
        const query = `
      SELECT * FROM rag_docs
      WHERE source_type = $1 AND source_unique_id = $2
    `;
        const result = await pool.query(query, [source_type, source_unique_id]);
        return result.rows[0] || null;
    },

    /**
     * Update a document's content and embedding
     * @param {number} id - Document ID
     * @param {string} content - New content
     * @param {number[]} embedding - New embedding
     * @returns {Promise<Object>} - Updated document
     */
    async updateDoc(id, content, embedding) {
        const query = `
      UPDATE rag_docs
      SET content = $1, embedding = $2, updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `;
        const result = await pool.query(query, [content, embedding, id]);
        return result.rows[0];
    },

    /**
     * Delete a document
     * @param {number} id - Document ID
     * @returns {Promise<boolean>} - Success status
     */
    async deleteDoc(id) {
        const query = `
      DELETE FROM rag_docs
      WHERE id = $1
      RETURNING id
    `;
        const result = await pool.query(query, [id]);
        return result.rowCount > 0;
    },

    /**
     * Find similar documents using vector similarity search
     * @param {number[]} embedding - Query embedding
     * @param {number} limit - Maximum number of results
     * @returns {Promise<Object[]>} - Similar documents
     */
    async findSimilar(embedding, limit = 5) {
        const query = `
      SELECT *, 1 - (embedding <=> $1) as similarity
      FROM rag_docs
      ORDER BY embedding <=> $1
      LIMIT $2
    `;
        const result = await pool.query(query, [embedding, limit]);
        return result.rows;
    },

    /**
     * Close the database connection pool
     */
    async close() {
        await pool.end();
    },
};

module.exports = database; 