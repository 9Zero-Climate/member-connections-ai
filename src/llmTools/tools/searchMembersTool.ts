import type { ChatCompletionTool } from 'openai/resources/chat';
import groupBy from 'lodash/groupby';
import {
  type Document,
  type DocumentWithMemberContextAndSimilarity,
  OfficeLocation,
  findSimilar,
} from '../../services/database';
import { generateEmbeddings } from '../../services/embedding';
import type { LLMTool } from '../LLMToolInterface';

export interface SearchMembersToolParams {
  queries: string[];
  location?: string;
  checkedInOnly?: boolean;
  limit?: number;
}

type DocumentWithMemberContextAndQuery = DocumentWithMemberContextAndSimilarity & {
  query: string;
};

type DocumentWithCombinedMatchedQueries = Document & {
  combinedMatchScore: number;
  matchScoresByQuery: Record<string, number>;
};

export type DocumentWithQuery = Document & {
  query: string;
};

export type MemberSearchMemberResult = {
  name: string | null;
  slackId: string | null;
  linkedinUrl: string | null;
  location: OfficeLocation | null;
  checkinLocationToday: OfficeLocation | null;
  isCheckedInToday: boolean;

  matchedQueries: string[];
  relevantDocuments: DocumentWithCombinedMatchedQueries[];
};

export interface SearchMembersToolResult {
  members: MemberSearchMemberResult[];
}

const DEFAULT_DOCUMENT_LIMIT_PER_QUERY = 20;

const searchMembersSpec: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'searchUsers',
    description:
      'Search for users who are associated with documents (Slack messages, LinkedIn experiences, and the members database) using semantic similarity based on the content of documents. Search results will include metadata about the member such as their office location and currently checked in location.',
    parameters: {
      type: 'object',
      properties: {
        queries: {
          type: 'array',
          description:
            'An array of search queries. Users with data matching any of the queries will be included in the results, with those matching more queries being ranked higher. If looking for CTOs in agroforestry for instance, you might use ["CTO", "agroforestry"] as your queries.',
        },
        location: {
          type: 'string',
          enum: Object.values(OfficeLocation),
          description:
            'If provided, results will be filtered to only include users in the given 9Zero location. Recommend keeping this blank unless the user asks for results in a specific location.',
        },
        checkedInOnly: {
          type: 'boolean',
          description:
            'If true, results will be filtered to only include users who are currently checked in. Recommend keeping this false unless the user asks for results for checked in users or "users here today".',
        },
        limit: {
          type: 'number',
          description: `Number of results to return from each query. Request at least ${DEFAULT_DOCUMENT_LIMIT_PER_QUERY} results and then hand-sort through the results. Since this is a "fuzzy" semantic search, some results may be irrelevant and should be ignored.`,
          default: DEFAULT_DOCUMENT_LIMIT_PER_QUERY,
        },
      },
      required: ['queries'],
    },
  },
};

/* Dedup documents by source_unique_id and combine matchedQueries */
export const combineDocumentsFromMultipleQueries = (
  documents: DocumentWithMemberContextAndQuery[],
): DocumentWithCombinedMatchedQueries[] => {
  const documentsBySourceUniqueId: Record<string, DocumentWithCombinedMatchedQueries> = {};
  for (const document of documents) {
    const existingCombinedDoc = documentsBySourceUniqueId[document.source_unique_id];
    const matchScoresByQuery = existingCombinedDoc?.matchScoresByQuery || {};
    let combinedMatchScore = existingCombinedDoc?.combinedMatchScore || 0;

    if (!matchScoresByQuery[document.query]) {
      matchScoresByQuery[document.query] = 0;
    }
    matchScoresByQuery[document.query] += document.similarity;
    combinedMatchScore += document.similarity;

    if (!existingCombinedDoc) {
      documentsBySourceUniqueId[document.source_unique_id] = {
        source_type: document.source_type,
        source_unique_id: document.source_unique_id,
        content: document.content,
        embedding: document.embedding,
        matchScoresByQuery,
        combinedMatchScore,
      };
    } else {
      // Document already exists, just update scoring info
      existingCombinedDoc.matchScoresByQuery = matchScoresByQuery;
      existingCombinedDoc.combinedMatchScore = combinedMatchScore;
    }
  }
  const combinedDocuments = Object.values(documentsBySourceUniqueId);
  return combinedDocuments.sort((a, b) => b.combinedMatchScore - a.combinedMatchScore);
};

export const coallateDocumentsByMember = (
  documents: DocumentWithMemberContextAndQuery[],
): MemberSearchMemberResult[] => {
  const documentsByMember: Record<string, DocumentWithMemberContextAndQuery[]> = groupBy(
    documents,
    'member_officernd_id',
  );

  const membersFormatted: MemberSearchMemberResult[] = Object.values(documentsByMember).map((documents) => {
    // All documents have the same member information (e.g. name), just grab the first one to extract that info
    const firstDocument = documents[0];
    const matchedQueries = [...new Set(documents.map((document) => document.query))];
    const relevantDocuments = combineDocumentsFromMultipleQueries(documents);
    return {
      name: firstDocument.member_name,
      location: firstDocument.member_location,
      slackId: firstDocument.member_slack_id,
      linkedinUrl: firstDocument.member_linkedin_url,
      checkinLocationToday: firstDocument.member_checkin_location_today,
      isCheckedInToday: firstDocument.member_is_checked_in_today,
      matchedQueries,
      relevantDocuments,
    };
  });
  return membersFormatted;
};

export const getShortDescription = (params: SearchMembersToolParams) => {
  const locationSection = params.location ? ` in ${params.location}` : '';
  const queriesSection = params.queries?.length > 0 ? ` associated with "${params.queries.join(', ')}"` : '';
  const checkedInOnlySection = params.checkedInOnly ? ' who are checked in today' : '';
  return `Search for members${locationSection}${queriesSection}${checkedInOnlySection}`;
};

export const SearchMembersTool: LLMTool<SearchMembersToolParams, SearchMembersToolResult> = {
  forAdminsOnly: false,
  specForLLM: searchMembersSpec,
  getShortDescription,

  impl: async ({
    queries,
    location,
    checkedInOnly,
    limit = DEFAULT_DOCUMENT_LIMIT_PER_QUERY,
  }: SearchMembersToolParams): Promise<SearchMembersToolResult> => {
    // Add a combined query to catch documents that match multiple queries
    const combinedQuery = queries.join(' ');
    const extendedQueries = [combinedQuery, ...queries];

    const queriesWithEmbeddings = await generateEmbeddings(extendedQueries);
    const documentsMatched: DocumentWithMemberContextAndQuery[] = [];

    for (const [index, query] of extendedQueries.entries()) {
      const queryEmbedding = queriesWithEmbeddings[index];
      const documents = await findSimilar(queryEmbedding, {
        limit,
        memberLocation: location as OfficeLocation,
        memberCheckedInOnly: checkedInOnly,
        excludeEmbeddingsFromResults: true,
      });
      documentsMatched.push(...documents.map((document) => ({ ...document, query })));
    }
    return {
      members: coallateDocumentsByMember(documentsMatched),
    };
  },
};
