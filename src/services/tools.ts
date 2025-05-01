import { XMLBuilder } from 'fast-xml-parser';
import { findSimilar, getLinkedInDocumentsByName } from './database';
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

export interface LinkedInProfileToolParams {
  memberName: string;
}

export interface LinkedInProfileToolResult {
  documents: Document[];
  memberName: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
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
  const documents = await findSimilar(queryEmbedding, { limit, excludeEmbeddingsFromResults: true });

  return {
    documents,
    query,
  };
}

/**
 * Fetch LinkedIn profile data for a given member name from the database
 */
export async function fetchLinkedInProfile(params: LinkedInProfileToolParams): Promise<LinkedInProfileToolResult> {
  const { memberName } = params;
  const documents = await getLinkedInDocumentsByName(memberName);
  return {
    documents,
    memberName,
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
        'Search for relevant content (Slack messages, LinkedIn experiences, and data from the Notion members database) using semantic similarity based on the content of results. Tips: Rather than attempting multi-topic searches (e.g., investors AND solar), instead consider multiple specific searches (one for "investors", one for "solar", one for "investors in solar").',
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
              'Maximum number of results to return. Use 20 as a minimum and then hand-sort through the results.',
            default: DEFAULT_DOCUMENT_LIMIT,
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetchLinkedInProfile',
      description: 'Fetch LinkedIn profile data for a given member name from the database.',
      parameters: {
        type: 'object',
        properties: {
          memberName: {
            type: 'string',
            description: "The member's full name to fetch LinkedIn data for e.g. 'Jason Curtis'",
          },
        },
        required: ['memberName'],
      },
    },
  },
];

export const getToolCallShortDescription = (toolCall: ToolCall) => {
  if (toolCall.type !== 'function') {
    throw new Error(`Unhandled tool call type - not a function: ${JSON.stringify(toolCall, null, 2)}`);
  }

  const toolName = toolCall.function.name;
  const toolArgs = JSON.parse(toolCall.function.arguments);

  switch (toolName) {
    case 'searchDocuments':
      return `Semantic search for "${toolArgs.query}"`;
    case 'fetchLinkedInProfile':
      return `Fetch LinkedIn profile for ${toolArgs.memberName}`;
    default:
      throw new Error(`Unhandled tool call: ${toolName}`);
  }
};

// Map of tool names to their implementations
export const toolImplementations = {
  searchDocuments,
  fetchLinkedInProfile,
};
