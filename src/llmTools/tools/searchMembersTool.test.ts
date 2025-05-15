import { OfficeLocation } from '../../services/database';
import type { DocumentWithMemberContextAndSimilarity } from '../../services/database';
import {
  type SearchMembersToolParams,
  coallateDocumentsByMember,
  combineDocumentsFromMultipleQueries,
  getShortDescription,
} from './searchMembersTool';

interface MockMemberDetails {
  officernd_id: string;
  name: string;
  location: OfficeLocation;
  slack_id: string;
  linkedin_url: string | null;
  checkin_location_today: OfficeLocation | null;
  is_checked_in_today: boolean;
}

const createMockDocForCombine = (
  params: Partial<DocumentWithMemberContextAndSimilarity & { query: string }>,
): DocumentWithMemberContextAndSimilarity & { query: string } => {
  const defaults: DocumentWithMemberContextAndSimilarity & { query: string } = {
    source_type: 'slack',
    source_unique_id: 'default_source_id',
    content: 'default content',
    embedding: [0.1, 0.2],
    metadata: { original_timestamp: new Date().toISOString() },
    // member context fields
    member_officernd_id: 'member_default',
    member_name: 'Default Member',
    member_location: OfficeLocation.SEATTLE,
    member_slack_id: 'U_DEFAULT_MEMBER',
    member_linkedin_url: 'https://linkedin.com/in/default',
    member_notion_page_url: null,
    member_checkin_location_today: null,
    member_is_checked_in_today: false,
    // query-related fields
    similarity: 0.5,
    query: 'default_query',
    ...params,
  };
  return defaults;
};

const createMockDocForCoallate = (
  params: Partial<DocumentWithMemberContextAndSimilarity & { query: string }> & { memberDetails?: MockMemberDetails },
): DocumentWithMemberContextAndSimilarity & { query: string } => {
  const { memberDetails, ...docParams } = params;
  const memberFields = memberDetails
    ? {
        member_officernd_id: memberDetails.officernd_id,
        member_name: memberDetails.name,
        member_location: memberDetails.location,
        member_slack_id: memberDetails.slack_id,
        member_linkedin_url: memberDetails.linkedin_url,
        member_checkin_location_today: memberDetails.checkin_location_today,
        member_is_checked_in_today: memberDetails.is_checked_in_today,
      }
    : {};

  const defaults: DocumentWithMemberContextAndSimilarity & { query: string } = {
    source_type: 'slack',
    source_unique_id: 'default_source_id',
    content: 'default content',
    embedding: [0.1, 0.2],
    metadata: { original_timestamp: new Date().toISOString() },
    // member context fields
    member_officernd_id: 'member_default',
    member_name: 'Default Member',
    member_location: OfficeLocation.SEATTLE,
    member_slack_id: 'U_DEFAULT_MEMBER',
    member_linkedin_url: 'https://linkedin.com/in/default',
    member_notion_page_url: null,
    member_checkin_location_today: null,
    member_is_checked_in_today: false,
    // query-related fields
    similarity: 0.5,
    query: 'default_query',
    ...memberFields, // Apply memberDetails if provided
    ...docParams, // Apply other specific params, potentially overriding memberDetails
  };
  return defaults;
};

describe('searchMembersTool', () => {
  const HIGH_SIMILARITY = 0.9;
  const MEDIUM_SIMILARITY = 0.8;
  const LOW_SIMILARITY = 0.2;

  describe('combineDocumentsFromMultipleQueries', () => {
    const DOC1_ID = 'doc1';
    const DOC2_ID = 'doc2';
    const QUERY1 = 'query1';
    const QUERY2 = 'query2';
    const CONTENT_DOC1 = 'Content for doc1';
    const CONTENT_DOC2 = 'Content for doc2';
    const TEST_CONTENT_SINGLE_DOC = 'Test Content';

    it('combines documents, sums scores, and sorts by combinedMatchScore descending', () => {
      const doc1_q1 = createMockDocForCombine({
        source_unique_id: DOC1_ID,
        query: QUERY1,
        similarity: MEDIUM_SIMILARITY,
        content: CONTENT_DOC1,
      });
      const doc1_q2 = createMockDocForCombine({
        source_unique_id: DOC1_ID,
        query: QUERY2,
        similarity: LOW_SIMILARITY,
      });

      const doc2_q1 = createMockDocForCombine({
        source_unique_id: DOC2_ID,
        query: QUERY1,
        similarity: HIGH_SIMILARITY,
        content: CONTENT_DOC2,
      });

      const doc3_q_other = createMockDocForCombine({
        source_unique_id: 'doc3',
        query: 'other_query',
        similarity: MEDIUM_SIMILARITY + LOW_SIMILARITY + HIGH_SIMILARITY,
        content: 'Highest score content',
      });

      const documents = [doc1_q1, doc2_q1, doc1_q2, doc3_q_other];
      const combined = combineDocumentsFromMultipleQueries(documents);

      expect(combined).toHaveLength(3);

      expect(combined[0]).toEqual(
        expect.objectContaining({
          source_unique_id: 'doc3',
          combinedMatchScore: expect.closeTo(1.9),
        }),
      );
      expect(combined[1]).toEqual(
        expect.objectContaining({
          source_unique_id: DOC1_ID,
          content: CONTENT_DOC1,
          matchScoresByQuery: { [QUERY1]: MEDIUM_SIMILARITY, [QUERY2]: LOW_SIMILARITY },
          combinedMatchScore: expect.closeTo(MEDIUM_SIMILARITY + LOW_SIMILARITY),
        }),
      );
      expect(combined[1]?.metadata).toBeUndefined();

      expect(combined[2]).toEqual(
        expect.objectContaining({
          source_unique_id: DOC2_ID,
          content: CONTENT_DOC2,
          matchScoresByQuery: { [QUERY1]: HIGH_SIMILARITY },
          combinedMatchScore: expect.closeTo(HIGH_SIMILARITY),
        }),
      );
      expect(combined[2]?.metadata).toBeUndefined();
    });

    it('handles documents with unique queries and sorts them', () => {
      const doc1 = createMockDocForCombine({
        source_unique_id: DOC1_ID,
        query: QUERY1,
        similarity: MEDIUM_SIMILARITY,
        content: CONTENT_DOC1,
      });
      const doc2 = createMockDocForCombine({
        source_unique_id: DOC2_ID,
        query: QUERY2,
        similarity: LOW_SIMILARITY,
        content: CONTENT_DOC2,
      });
      const documents = [doc1, doc2];
      const combined = combineDocumentsFromMultipleQueries(documents);

      expect(combined).toHaveLength(2);
      expect(combined[0]).toEqual(
        expect.objectContaining({
          source_unique_id: DOC1_ID,
          content: CONTENT_DOC1,
          matchScoresByQuery: { [QUERY1]: MEDIUM_SIMILARITY },
          combinedMatchScore: expect.closeTo(MEDIUM_SIMILARITY),
        }),
      );
      expect(combined[1]).toEqual(
        expect.objectContaining({
          source_unique_id: DOC2_ID,
          content: CONTENT_DOC2,
          matchScoresByQuery: { [QUERY2]: LOW_SIMILARITY },
          combinedMatchScore: expect.closeTo(LOW_SIMILARITY),
        }),
      );
    });

    it('returns an empty array if input is empty', () => {
      expect(combineDocumentsFromMultipleQueries([])).toEqual([]);
    });

    it('only keeps specific fields in the combined document and strips member context', () => {
      const originalDoc = createMockDocForCombine({
        source_type: 'linkedin',
        source_unique_id: 'doc-fields',
        query: QUERY1,
        similarity: HIGH_SIMILARITY,
        content: TEST_CONTENT_SINGLE_DOC,
        embedding: [0.1, 0.2, 0.3],
        metadata: { custom_field: 'custom_value', another: 123 },
        member_name: 'Member Fields',
        member_location: OfficeLocation.SAN_FRANCISCO,
        member_officernd_id: 'member_xyz',
      });
      const documents = [originalDoc];
      const combined = combineDocumentsFromMultipleQueries(documents);

      expect(combined).toHaveLength(1);
      const combinedDoc = combined[0];

      expect(combinedDoc).toEqual(
        expect.objectContaining({
          source_type: 'linkedin',
          source_unique_id: 'doc-fields',
          content: TEST_CONTENT_SINGLE_DOC,
          embedding: [0.1, 0.2, 0.3],
          matchScoresByQuery: { [QUERY1]: HIGH_SIMILARITY },
          combinedMatchScore: expect.closeTo(HIGH_SIMILARITY),
        }),
      );
      expect(combinedDoc.metadata).toBeUndefined();
      expect(combinedDoc).not.toHaveProperty('query');
      expect(combinedDoc).not.toHaveProperty('similarity');
      expect(combinedDoc).not.toHaveProperty('member_name');
      expect(combinedDoc).not.toHaveProperty('member_location');
      expect(combinedDoc).not.toHaveProperty('member_officernd_id');
      expect(combinedDoc).not.toHaveProperty('member_slack_id');
      expect(combinedDoc).not.toHaveProperty('member_linkedin_url');
      expect(combinedDoc).not.toHaveProperty('member_notion_page_url');
      expect(combinedDoc).not.toHaveProperty('member_checkin_location_today');
      expect(combinedDoc).not.toHaveProperty('member_is_checked_in_today');

      const expectedKeys = [
        'source_type',
        'source_unique_id',
        'content',
        'embedding',
        'matchScoresByQuery',
        'combinedMatchScore',
      ];
      expect(Object.keys(combinedDoc).sort()).toEqual(expectedKeys.sort());
    });
  });

  describe('coallateDocumentsByMember', () => {
    const MEMBER1_ID = 'member1';
    const MEMBER1_NAME = 'Alice Wonderland';
    const MEMBER1_SLACK_ID = 'U_ALICE';
    const MEMBER1_LINKEDIN = 'https://linkedin.com/in/alice';
    const MEMBER1_DETAILS: MockMemberDetails = {
      officernd_id: MEMBER1_ID,
      name: MEMBER1_NAME,
      slack_id: MEMBER1_SLACK_ID,
      linkedin_url: MEMBER1_LINKEDIN,
      location: OfficeLocation.SEATTLE,
      checkin_location_today: OfficeLocation.SEATTLE,
      is_checked_in_today: true,
    };

    const MEMBER2_ID = 'member2';
    const MEMBER2_NAME = 'Bob The Builder';
    const MEMBER2_SLACK_ID = 'U_BOB';
    const MEMBER2_LINKEDIN = 'https://linkedin.com/in/bob';
    const MEMBER2_DETAILS: MockMemberDetails = {
      officernd_id: MEMBER2_ID,
      name: MEMBER2_NAME,
      slack_id: MEMBER2_SLACK_ID,
      linkedin_url: MEMBER2_LINKEDIN,
      location: OfficeLocation.SAN_FRANCISCO,
      checkin_location_today: null,
      is_checked_in_today: false,
    };

    const QUERY_A = 'queryA';
    const QUERY_B = 'queryB';

    const DOC_A1_ID = 'docA1';
    const DOC_A1_CONTENT = 'Alice doc 1 content';
    const DOC_A2_ID = 'docA2';
    const DOC_A2_CONTENT = 'Alice doc 2 content';
    const DOC_B1_ID = 'docB1';
    const DOC_B1_CONTENT = 'Bob doc 1 content';

    const QUERY1 = 'query1_coallate';
    const QUERY2 = 'query2_coallate';
    const DOC1_ID = 'doc1_coallate';
    const DOC2_ID = 'doc2_coallate';

    const DOC1_ID_FOR_MULTI_MATCH = 'doc1_multi';
    const DOC2_ID_FOR_MULTI_MATCH = 'doc2_multi';

    const MEMBER_X_ID = 'memberX';
    const MEMBER_X_CORRECT_NAME = 'Correct Name';
    const MEMBER_X_CORRECT_SLACK_ID = 'U_CORRECT';
    const MEMBER_X_INCORRECT_NAME = 'Incorrect Name Should Be Ignored';
    const MEMBER_X_INCORRECT_SLACK_ID = 'U_INCORRECT';

    const MEMBER_X_CORRECT_DETAILS: MockMemberDetails = {
      officernd_id: MEMBER_X_ID,
      name: MEMBER_X_CORRECT_NAME,
      slack_id: MEMBER_X_CORRECT_SLACK_ID,
      location: OfficeLocation.SEATTLE,
      linkedin_url: 'https://linkedin.com/in/correctx',
      checkin_location_today: null,
      is_checked_in_today: false,
    };

    const MEMBER_X_INCORRECT_DETAILS: MockMemberDetails = {
      officernd_id: MEMBER_X_ID,
      name: MEMBER_X_INCORRECT_NAME,
      slack_id: MEMBER_X_INCORRECT_SLACK_ID,
      location: OfficeLocation.SAN_FRANCISCO,
      linkedin_url: 'https://linkedin.com/in/incorrectx',
      checkin_location_today: OfficeLocation.SEATTLE,
      is_checked_in_today: true,
    };

    it('groups documents by member_officernd_id and formats them correctly (relevant docs sorted)', () => {
      const docM1Q_A_high = createMockDocForCoallate({
        memberDetails: MEMBER1_DETAILS,
        query: QUERY_A,
        similarity: HIGH_SIMILARITY,
        source_unique_id: DOC_A1_ID,
        content: DOC_A1_CONTENT,
        embedding: [0.1],
      });
      const docM1Q_B_medium = createMockDocForCoallate({
        memberDetails: MEMBER1_DETAILS,
        query: QUERY_B,
        similarity: MEDIUM_SIMILARITY,
        source_unique_id: DOC_A2_ID,
        content: DOC_A2_CONTENT,
        embedding: [0.2],
      });
      const docM2Q_A_low = createMockDocForCoallate({
        memberDetails: MEMBER2_DETAILS,
        query: QUERY_A,
        similarity: LOW_SIMILARITY,
        source_unique_id: DOC_B1_ID,
        content: DOC_B1_CONTENT,
        embedding: [0.3],
      });

      const documents = [docM1Q_A_high, docM1Q_B_medium, docM2Q_A_low];
      const coallated = coallateDocumentsByMember(documents);

      expect(coallated).toHaveLength(2);

      const memberAlice = coallated.find((m) => m.slackId === MEMBER1_SLACK_ID);
      expect(memberAlice).toEqual(
        expect.objectContaining({
          name: MEMBER1_NAME,
          location: OfficeLocation.SEATTLE,
          slackId: MEMBER1_SLACK_ID,
          linkedinUrl: MEMBER1_LINKEDIN,
          checkinLocationToday: OfficeLocation.SEATTLE,
          isCheckedInToday: true,
          matchedQueries: expect.arrayContaining([QUERY_A, QUERY_B]),
        }),
      );
      expect(memberAlice?.matchedQueries).toHaveLength(2);
      expect(memberAlice?.relevantDocuments).toEqual([
        expect.objectContaining({
          source_unique_id: DOC_A1_ID,
          content: DOC_A1_CONTENT,
          combinedMatchScore: expect.closeTo(HIGH_SIMILARITY),
          matchScoresByQuery: { [QUERY_A]: HIGH_SIMILARITY },
        }),
        expect.objectContaining({
          source_unique_id: DOC_A2_ID,
          content: DOC_A2_CONTENT,
          combinedMatchScore: expect.closeTo(MEDIUM_SIMILARITY),
          matchScoresByQuery: { [QUERY_B]: MEDIUM_SIMILARITY },
        }),
      ]);

      const memberBob = coallated.find((m) => m.slackId === MEMBER2_SLACK_ID);
      expect(memberBob).toEqual(
        expect.objectContaining({
          name: MEMBER2_NAME,
          location: OfficeLocation.SAN_FRANCISCO,
          slackId: MEMBER2_SLACK_ID,
          linkedinUrl: MEMBER2_LINKEDIN,
          matchedQueries: [QUERY_A],
        }),
      );
      expect(memberBob?.relevantDocuments).toEqual([
        expect.objectContaining({
          source_unique_id: DOC_B1_ID,
          content: DOC_B1_CONTENT,
          combinedMatchScore: expect.closeTo(LOW_SIMILARITY),
          matchScoresByQuery: { [QUERY_A]: LOW_SIMILARITY },
        }),
      ]);
    });

    it('handles cases where a member has multiple source documents for the same query (combined by combineDocumentsFromMultipleQueries)', () => {
      const docM1QAd1 = createMockDocForCoallate({
        memberDetails: MEMBER1_DETAILS,
        query: QUERY_A,
        similarity: HIGH_SIMILARITY,
        source_unique_id: DOC1_ID_FOR_MULTI_MATCH,
      });
      const docM1QAd1_again = createMockDocForCoallate({
        memberDetails: MEMBER1_DETAILS,
        query: QUERY_A,
        similarity: MEDIUM_SIMILARITY,
        source_unique_id: DOC1_ID_FOR_MULTI_MATCH,
      });
      const docM1QB_d2 = createMockDocForCoallate({
        memberDetails: MEMBER1_DETAILS,
        query: QUERY_B,
        similarity: LOW_SIMILARITY,
        source_unique_id: DOC2_ID_FOR_MULTI_MATCH,
      });

      const documents = [docM1QAd1, docM1QAd1_again, docM1QB_d2];
      const coallated = coallateDocumentsByMember(documents);

      expect(coallated).toHaveLength(1);
      const memberAlice = coallated[0];
      expect(memberAlice).toEqual(
        expect.objectContaining({
          name: MEMBER1_NAME,
          matchedQueries: expect.arrayContaining([QUERY_A, QUERY_B]),
        }),
      );
      expect(memberAlice.matchedQueries).toHaveLength(2);

      expect(memberAlice.relevantDocuments).toEqual([
        expect.objectContaining({
          source_unique_id: DOC1_ID_FOR_MULTI_MATCH,
          matchScoresByQuery: { [QUERY_A]: expect.closeTo(HIGH_SIMILARITY + MEDIUM_SIMILARITY) },
          combinedMatchScore: expect.closeTo(HIGH_SIMILARITY + MEDIUM_SIMILARITY),
        }),
        expect.objectContaining({
          source_unique_id: DOC2_ID_FOR_MULTI_MATCH,
          matchScoresByQuery: { [QUERY_B]: LOW_SIMILARITY },
          combinedMatchScore: expect.closeTo(LOW_SIMILARITY),
        }),
      ]);
    });

    it('returns an empty array if input is empty', () => {
      expect(coallateDocumentsByMember([])).toEqual([]);
    });

    it('correctly uses the first document for member-specific static info (name, location, etc.)', () => {
      const doc1 = createMockDocForCoallate({
        memberDetails: MEMBER_X_CORRECT_DETAILS,
        query: QUERY1,
        source_unique_id: DOC1_ID,
      });
      const doc2 = createMockDocForCoallate({
        memberDetails: MEMBER_X_INCORRECT_DETAILS,
        query: QUERY2,
        source_unique_id: DOC2_ID,
      });
      const documents = [doc1, doc2];
      const coallated = coallateDocumentsByMember(documents);

      expect(coallated).toHaveLength(1);
      const member = coallated[0];
      expect(member).toEqual(
        expect.objectContaining({
          name: MEMBER_X_CORRECT_NAME,
          location: OfficeLocation.SEATTLE,
          slackId: MEMBER_X_CORRECT_SLACK_ID,
          matchedQueries: expect.arrayContaining([QUERY1, QUERY2]),
        }),
      );
      expect(member.matchedQueries).toHaveLength(2);
      expect(member.relevantDocuments).toHaveLength(2);
    });
  });

  describe('getShortDescription', () => {
    const testCases: { name: string; params: SearchMembersToolParams; expected: string }[] = [
      {
        name: 'only queries (single)',
        params: { queries: ['test query'] },
        expected: 'Search for members associated with "test query"',
      },
      {
        name: 'only queries (multiple)',
        params: { queries: ['query1', 'query2'] },
        expected: 'Search for members associated with "query1, query2"',
      },
      {
        name: 'queries and location',
        params: { queries: ['tech'], location: OfficeLocation.SEATTLE },
        expected: 'Search for members in Seattle associated with "tech"',
      },
      {
        name: 'queries and checkedInOnly',
        params: { queries: ['art'], checkedInOnly: true },
        expected: 'Search for members associated with "art" who are checked in today',
      },
      {
        name: 'queries, location, and checkedInOnly',
        params: { queries: ['finance'], location: OfficeLocation.SAN_FRANCISCO, checkedInOnly: true },
        expected: 'Search for members in San Francisco associated with "finance" who are checked in today',
      },
      {
        name: 'only location',
        params: { queries: [], location: OfficeLocation.SEATTLE },
        expected: 'Search for members in Seattle',
      },
      {
        name: 'only checkedInOnly',
        params: { queries: [], checkedInOnly: true },
        expected: 'Search for members who are checked in today',
      },
      {
        name: 'location and checkedInOnly',
        params: { queries: [], location: OfficeLocation.SAN_FRANCISCO, checkedInOnly: true },
        expected: 'Search for members in San Francisco who are checked in today',
      },
      {
        name: 'no specific params (empty queries)',
        params: { queries: [] },
        expected: 'Search for members',
      },
      {
        name: 'no specific params (undefined queries, location, checkedInOnly)',
        params: {} as SearchMembersToolParams,
        expected: 'Search for members',
      },
    ];

    it.each(testCases)('returns correct description for $name', ({ params, expected }) => {
      expect(getShortDescription(params)).toBe(expected);
    });
  });
});
