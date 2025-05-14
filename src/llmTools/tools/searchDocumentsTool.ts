import type { ChatCompletionTool } from 'openai/resources/chat';
import { type Document, findSimilar } from '../../services/database';
import { generateEmbedding } from '../../services/embedding';
import type { LLMToolInstance } from '../LLMToolInterface';

export interface SearchToolParams {
  query: string;
  limit?: number;
}

export interface SearchToolResult {
  documents: Document[];
  query: string;
}

const DEFAULT_DOCUMENT_LIMIT = 20;

const searchDocumentsSpec: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'searchDocuments',
    description:
      'Search for relevant content (Slack messages, LinkedIn experiences, and the members database) using semantic similarity based on the content of results. Search results will include metadata about the member such as their office location and currently checked in location. Tips: Rather than attempting multi-topic searches (e.g., investors AND solar), instead consider multiple specific searches (one for "investors", one for "solar", one for "investors in solar").',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'The search query. Content from Slack, LinkedIn, and Notion profiles will be ranked by semantic similarity. Use terms similar to what you want to find. If you want a member\'s full LinkedIn profile, use the "fetchLinkedInProfile" tool instead.',
        },
        limit: {
          type: 'number',
          description:
            'Number of results to return. Use 20 as a minimum and then hand-sort through the results. Since this is a "fuzzy" semantiic search, some results may be irrelevant and should be ignored.',
          default: DEFAULT_DOCUMENT_LIMIT,
        },
      },
      required: ['query'],
    },
  },
};

// This function will be the implementation for the tool
const searchDocumentsImpl = async (params: SearchToolParams): Promise<SearchToolResult> => {
  const { query, limit = DEFAULT_DOCUMENT_LIMIT } = params;
  const queryEmbedding = await generateEmbedding(query);
  const documents = await findSimilar(queryEmbedding, { limit, excludeEmbeddingsFromResults: true });
  return {
    documents,
    query,
  };
};

export class SearchDocumentsTool implements LLMToolInstance<SearchToolParams, SearchToolResult> {
  static readonly toolName = 'searchDocuments';
  static readonly forAdminsOnly = false;
  static readonly specForLLM: ChatCompletionTool = searchDocumentsSpec;
  static readonly getShortDescription = (params: SearchToolParams) => `Semantic search for "${params.query}"`;

  impl = searchDocumentsImpl;
}
