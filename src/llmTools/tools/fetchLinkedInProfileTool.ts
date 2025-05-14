import type { ChatCompletionTool } from 'openai/resources/chat';
import { NINEZERO_SLACK_MEMBER_LINK_PREFIX } from '../../assistant/prompts'; // Assuming this is the correct path
import { type Document, getLinkedInDocumentsByMemberIdentifier } from '../../services/database';
import type { LLMTool } from '../LLMToolInterface';

export interface LinkedInProfileToolParams {
  memberIdentifier: string;
}

export interface LinkedInProfileToolResult {
  documents: Document[];
  memberIdentifier: string;
}

const fetchLinkedInProfileSpec: ChatCompletionTool = {
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
};

const looksLikeSlackId = (identifier: string): boolean => /^U[A-Z0-9]+$/.test(identifier);

export const FetchLinkedInProfileTool: LLMTool<LinkedInProfileToolParams, LinkedInProfileToolResult> = {
  toolName: 'fetchLinkedInProfile',
  forAdminsOnly: false,
  specForLLM: fetchLinkedInProfileSpec,
  getShortDescription: (params: LinkedInProfileToolParams) => {
    const memberIdForDisplay = looksLikeSlackId(params.memberIdentifier)
      ? `${NINEZERO_SLACK_MEMBER_LINK_PREFIX}${params.memberIdentifier} `
      : params.memberIdentifier;
    return `Fetch LinkedIn profile for ${memberIdForDisplay}`;
  },

  impl: async ({ memberIdentifier }: LinkedInProfileToolParams) => {
    const documents = await getLinkedInDocumentsByMemberIdentifier(memberIdentifier);
    return {
      documents,
      memberIdentifier,
    };
  },
};
