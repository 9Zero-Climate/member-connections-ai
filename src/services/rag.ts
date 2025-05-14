import { findSimilar } from './database';
import { generateEmbedding } from './embedding';
import { logger } from './logger';

interface RagOptions {
  limit?: number;
}

interface Document {
  content: string;
  metadata?: Record<string, unknown>;
  similarity?: number;
}

/**
 * Retrieve relevant documents for a query using RAG
 * @param query - The user's query
 * @param options - RAG options
 * @returns Relevant documents with similarity scores
 */
async function retrieveRelevantDocs(query: string, options: RagOptions = {}): Promise<Document[]> {
  try {
    // Generate embedding for the query
    const queryEmbedding = await generateEmbedding(query);

    // Find similar documents
    const similarDocs = await findSimilar(queryEmbedding, options);

    return similarDocs;
  } catch (error) {
    logger.warn(error, 'Error in RAG retrieval');
    throw error;
  }
}

/**
 * Format retrieved documents for chat context
 * @param docs - Retrieved documents
 * @returns Formatted context string
 */
function formatDocsForContext(docs: Document[]): string {
  return docs
    .map((doc) => {
      const metadata = doc.metadata ? `\nMetadata: ${JSON.stringify(doc.metadata)}` : '';
      return `Content: ${doc.content}${metadata}\n`;
    })
    .join('\n');
}

export { retrieveRelevantDocs, formatDocsForContext };
