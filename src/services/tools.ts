import { XMLBuilder } from 'fast-xml-parser';
import { findSimilar } from './database';
import type { Document } from './database';
import { generateEmbedding } from './embedding';

export interface SearchToolParams {
  query: string;
  limit?: number;
}

export interface SearchToolResult {
  documents: Document[];
  query: string;
}

const DEFAULT_DOCUMENT_LIMIT = 20;
/**
 * Search for relevant documents using semantic search
 */
export async function searchDocuments(params: SearchToolParams): Promise<SearchToolResult> {
  const { query, limit = DEFAULT_DOCUMENT_LIMIT } = params;

  // Generate embedding for the query
  const queryEmbedding = await generateEmbedding(query);

  // Find similar documents
  const documents = await findSimilar(queryEmbedding, { limit });

  return {
    documents,
    query,
  };
}

/**
 * Convert an object to XML. XML is a best practice format for feeding into LLMs
 *
 * @param obj - The object to convert
 * @returns The XML string
 */
// biome-ignore lint/suspicious/noExplicitAny: we literally want to convert any object to XML
export function objectToXml(obj: any): string {
  const builder = new XMLBuilder({
    format: true,
    indentBy: '  ',
  });

  return builder.build(obj);
}

// Define our tools for the LLM
export const tools = [
  {
    type: 'function',
    function: {
      name: 'searchDocuments',
      description:
        'Search for relevant messages in the workspace and LinkeddIn profiles for members using semantic similarity',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to find relevant messages',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return',
            default: DEFAULT_DOCUMENT_LIMIT,
          },
        },
        required: ['query'],
      },
    },
  },
];

// Map of tool names to their implementations
export const toolImplementations = {
  searchDocuments,
};
