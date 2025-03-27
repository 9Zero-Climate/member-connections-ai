const { generateEmbedding } = require('./embedding');
const { findSimilar } = require('./database');

/**
 * Retrieve relevant documents for a query using RAG
 * @param {string} query - The user's query
 * @param {Object} options - RAG options
 * @param {number} options.limit - Maximum number of documents to retrieve
 * @returns {Promise<Object[]>} Relevant documents with similarity scores
 */
async function retrieveRelevantDocs(query, options = {}) {
    try {
        // Generate embedding for the query
        const queryEmbedding = await generateEmbedding(query);

        // Find similar documents
        const similarDocs = await findSimilar(queryEmbedding, options);

        return similarDocs;
    } catch (error) {
        console.error('Error in RAG retrieval:', error);
        throw error;
    }
}

/**
 * Format retrieved documents for chat context
 * @param {Object[]} docs - Retrieved documents
 * @returns {string} Formatted context string
 */
function formatDocsForContext(docs) {
    return docs.map(doc => {
        const metadata = doc.metadata ? `\nMetadata: ${JSON.stringify(doc.metadata)}` : '';
        return `Content: ${doc.content}${metadata}\n`;
    }).join('\n');
}

module.exports = {
    retrieveRelevantDocs,
    formatDocsForContext,
}; 