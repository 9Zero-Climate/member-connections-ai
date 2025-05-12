import { XMLBuilder } from 'fast-xml-parser';
import { NINEZERO_SLACK_MEMBER_LINK_PREFIX } from '../assistant/prompts';
import { findSimilar, getLinkedInDocumentsByMemberIdentifier } from './database';
import type { Document } from './database';
import { generateEmbedding } from './embedding';
import type { ChatCompletionTool } from 'openai/resources/chat';
import { createNewOnboardingDmWithAdmins } from '../assistant/createNewOnboardingDmWithAdmins';
import type { WebClient } from '@slack/web-api/dist/WebClient';
import { logger } from './logger';

// --- Argument Types for LLM Tool Calls ---

export interface SearchToolParams {
  query: string;
  limit?: number;
}

export interface LinkedInProfileToolParams {
  memberIdentifier: string;
}

// Params the LLM provides for createOnboardingThread
export interface CreateOnboardingThreadLLMParams {
  memberSlackId: string;
}
// Params needed by the actual createOnboardingThread implementation
export interface CreateOnboardingThreadImplParams extends CreateOnboardingThreadLLMParams {
  client: WebClient;
}

// --- Result Types for Tool Implementations ---

export interface SearchToolResult {
  documents: Document[];
  query: string;
}

export interface LinkedInProfileToolResult {
  documents: Document[];
  memberIdentifier: string;
}

export interface CreateOnboardingThreadResult {
  createdOnboardingDmId: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

// --- Tool Implementations ---

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
  const { memberIdentifier } = params;
  const documents = await getLinkedInDocumentsByMemberIdentifier(memberIdentifier);
  return {
    documents,
    memberIdentifier,
  };
}

const _createOnboardingThreadImpl = async ({
  client,
  memberSlackId,
}: CreateOnboardingThreadImplParams): Promise<CreateOnboardingThreadResult> => {
  const createdOnboardingDmId = await createNewOnboardingDmWithAdmins(client, memberSlackId);
  return {
    createdOnboardingDmId,
  };
};

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

const adminOnlyToolSpecs: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'createOnboardingThread',
      description:
        'Create a new onboarding thread for a new member. Use this when asked by an admin to onboard a new member.',
      parameters: {
        type: 'object',
        properties: {
          memberSlackId: {
            type: 'string',
            description: 'The member\'s slack ID to onboard e.g. "U07BA4JA3HC"',
          },
        },
        required: ['memberSlackId'],
      },
    },
  },
];

export type ToolName = 'searchDocuments' | 'fetchLinkedInProfile' | 'createOnboardingThread';

const isToolName = (name: string): name is ToolName => {
  return ['searchDocuments', 'fetchLinkedInProfile', 'createOnboardingThread'].includes(name);
};

export const getToolSpecs = (userIsAdmin: boolean): ChatCompletionTool[] => [
  {
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
  },
  {
    type: 'function',
    function: {
      name: 'fetchLinkedInProfile',
      description:
        "Fetch LinkedIn profile data for a given member from the database. Use this to get a member's full employment history, current position, and public-facing blurb.",
      parameters: {
        type: 'object',
        properties: {
          memberIdentifier: {
            type: 'string',
            description:
              "The member's full name, slack ID, or linkedin URL, or OfficeRnD ID to fetch LinkedIn data for e.g. 'Jason Curtis' or 'U07BA4JA3HC' or 'https://linkedin.com/in/jason-curtis/'",
          },
        },
        required: ['memberIdentifier'],
      },
    },
  },
  ...(userIsAdmin ? adminOnlyToolSpecs : []),
];

const looksLikeSlackId = (identifier: string) => {
  return /^U[A-Z0-9]+$/.test(identifier);
};

export const getToolCallShortDescription = (toolCall: ToolCall): string => {
  if (toolCall.type !== 'function') {
    logger.error({ toolCall }, 'Unhandled tool call type - not a function');
    throw new Error(`Unhandled tool call type - not a function: ${toolCall.type}`);
  }

  const toolName = toolCall.function.name;
  if (!isToolName(toolName)) {
    logger.error({ toolCall }, 'Unknown tool name encountered');
    throw new Error(`Unhandled tool call: ${toolName}`);
  }

  const toolArgs = JSON.parse(toolCall.function.arguments);

  switch (toolName) {
    case 'searchDocuments': {
      const searchArgs = toolArgs as SearchToolParams;
      return `Semantic search for "${searchArgs.query}"`;
    }
    case 'fetchLinkedInProfile': {
      const linkedInArgs = toolArgs as LinkedInProfileToolParams;
      const memberIdForDisplay = looksLikeSlackId(linkedInArgs.memberIdentifier)
        ? `${NINEZERO_SLACK_MEMBER_LINK_PREFIX}${linkedInArgs.memberIdentifier} `
        : linkedInArgs.memberIdentifier;
      return `Fetch LinkedIn profile for ${memberIdForDisplay}`;
    }
    case 'createOnboardingThread': {
      const createArgs = toolArgs as CreateOnboardingThreadLLMParams;
      return `Creating onboarding thread for <@${createArgs.memberSlackId}>`;
    }
    default: {
      throw new Error(`Unhandled tool case: ${toolName}`);
    }
  }
};

type ToolImplementation<Params, Result> = (params: Params) => Promise<Result>;
export type ToolImplementationsByName = {
  searchDocuments: ToolImplementation<SearchToolParams, SearchToolResult>;
  fetchLinkedInProfile: ToolImplementation<LinkedInProfileToolParams, LinkedInProfileToolResult>;
  createOnboardingThread?: ToolImplementation<CreateOnboardingThreadLLMParams, CreateOnboardingThreadResult>;
};

// Map of tool names to their implementations
export const getToolImplementationsMap = ({
  slackClient,
  userIsAdmin,
}: { slackClient: WebClient; userIsAdmin: boolean }): ToolImplementationsByName => {
  const adminOnlyToolImplementations = userIsAdmin
    ? {
        createOnboardingThread: (args: CreateOnboardingThreadLLMParams) =>
          _createOnboardingThreadImpl({ ...args, client: slackClient }),
      }
    : {};
  return {
    ...adminOnlyToolImplementations,
    searchDocuments: searchDocuments,
    fetchLinkedInProfile: fetchLinkedInProfile,
  };
};
