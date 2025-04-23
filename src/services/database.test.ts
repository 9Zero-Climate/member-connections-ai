import { Client } from 'pg';
import {
  bulkUpsertMembers,
  closeDbConnection,
  deleteDoc,
  deleteLinkedInDocuments,
  findSimilar,
  getDocBySource,
  insertOrUpdateDoc,
  setTestClient,
  updateMembersFromNotion,
  upsertNotionDataForMember,
} from './database';
import type { QueryParams, TestClient } from './database';
import { generateEmbeddings } from './embedding';

interface TestDoc {
  source_type: string;
  source_unique_id: string;
  content: string;
  embedding: number[] | null;
  metadata?: Record<string, unknown>;
}

// Helper function to generate test vectors of the correct dimension
// the "real" dimension is 1536, but the mock dimension is 12 for easier debugging
const vectorDimension = process.env.CI ? 1536 : 10;
function generateTestVector(seed = 0): number[] {
  return Array.from({ length: vectorDimension }, (_, i) => (i + seed) / vectorDimension);
}

function normalizeWhitespace(str: string): string {
  return str.replace(/\s+/g, ' ').trim();
}

jest.mock('./embedding', () => ({
  generateEmbeddings: jest.fn().mockResolvedValue([null]),
}));

describe('database', () => {
  let mockClient: TestClient;
  let mockQuery: jest.Mock;
  let realClient: Client | undefined;

  beforeEach(async () => {
    jest.clearAllMocks();

    if (process.env.CI) {
      // In CI, use real database
      realClient = new Client({
        connectionString: process.env.DB_URL,
      });
      await realClient.connect();
      setTestClient(realClient as unknown as TestClient);

      // Clear the table before each test
      await realClient.query('DELETE FROM rag_docs');
    } else {
      // In local development, use mocks
      mockClient = {
        query: jest.fn().mockImplementation((query: string, params?: QueryParams) => Promise.resolve({ rows: [] })),
        connect: jest.fn().mockImplementation(() => Promise.resolve()),
        end: jest.fn().mockImplementation(() => Promise.resolve()),
      };
      setTestClient(mockClient);
      mockQuery = mockClient.query as jest.Mock;
    }
  });

  afterEach(async () => {
    if (process.env.CI && realClient) {
      await realClient.end();
    }
  });

  describe('insertOrUpdateDoc', () => {
    it('should insert a document and return it', async () => {
      const doc = {
        source_type: 'test',
        source_unique_id: 'test-id',
        content: 'test content',
        embedding: null,
        metadata: {},
      };

      if (process.env.CI) {
        const result = await insertOrUpdateDoc(doc);
        expect(result).toMatchObject({
          source_type: doc.source_type,
          source_unique_id: doc.source_unique_id,
          content: doc.content,
          embedding: doc.embedding,
          metadata: {}, // PostgreSQL JSONB NOT NULL DEFAULT '{}'::jsonb
        });
        expect(result.created_at).toBeInstanceOf(Date);
        expect(result.updated_at).toBeInstanceOf(Date);
      } else {
        mockClient.query.mockResolvedValueOnce({ rows: [doc] });
        const result = await insertOrUpdateDoc(doc);
        expect(result).toEqual(doc);
        expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO rag_docs'), [
          doc.source_type,
          doc.source_unique_id,
          doc.content,
          null,
          doc.metadata,
        ]);
      }
    });

    it('should update an existing document', async () => {
      const updatedDoc = {
        source_type: 'test',
        source_unique_id: 'test-id',
        content: 'updated content',
        embedding: null,
        metadata: {},
      };

      if (process.env.CI) {
        const result = await insertOrUpdateDoc(updatedDoc);
        expect(result).toMatchObject({
          source_type: updatedDoc.source_type,
          source_unique_id: updatedDoc.source_unique_id,
          content: updatedDoc.content,
          embedding: updatedDoc.embedding,
          metadata: {}, // PostgreSQL JSONB NOT NULL DEFAULT '{}'::jsonb
        });
        expect(result.created_at).toBeInstanceOf(Date);
        expect(result.updated_at).toBeInstanceOf(Date);
      } else {
        mockClient.query.mockResolvedValueOnce({ rows: [updatedDoc] });
        const result = await insertOrUpdateDoc(updatedDoc);
        expect(result).toEqual(updatedDoc);
        expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO rag_docs'), [
          updatedDoc.source_type,
          updatedDoc.source_unique_id,
          updatedDoc.content,
          null,
          updatedDoc.metadata,
        ]);
      }
    });
  });

  describe('getDocBySource', () => {
    it('should return a document when found', async () => {
      if (process.env.CI) {
        // First insert a test document
        const testDoc: TestDoc = {
          source_type: 'test',
          source_unique_id: 'test123',
          content: 'test content',
          embedding: generateTestVector(),
          metadata: {
            user: 'U1234567890',
            channel: 'C1234567890',
            thread_ts: '1234567890.123456',
            reply_count: 2,
            reactions: [{ name: 'thumbsup', count: 1 }],
            permalink: 'https://slack.com/archives/C1234567890/p1234567890123456',
          },
        };
        await insertOrUpdateDoc(testDoc);

        const result = await getDocBySource('test123');
        expect(result).not.toBeNull();
        if (result) {
          expect(result).toMatchObject({
            source_type: testDoc.source_type,
            source_unique_id: testDoc.source_unique_id,
            content: testDoc.content,
            metadata: testDoc.metadata,
          });
          expect(result.embedding).toBeDefined();
        }
      } else {
        const mockDoc: TestDoc = {
          source_type: 'test',
          source_unique_id: 'test123',
          content: 'test content',
          embedding: generateTestVector(),
          metadata: {
            user: 'U1234567890',
            channel: 'C1234567890',
            thread_ts: '1234567890.123456',
            reply_count: 2,
            reactions: [{ name: 'thumbsup', count: 1 }],
            permalink: 'https://slack.com/archives/C1234567890/p1234567890123456',
          },
        };
        mockQuery.mockResolvedValueOnce({
          rows: [mockDoc],
        });

        const result = await getDocBySource('test123');
        expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM rag_docs WHERE source_unique_id = $1', ['test123']);
        expect(result).toEqual({
          ...mockDoc,
          embedding: generateTestVector(),
        });
      }
    });

    it('should return null when document not found', async () => {
      if (process.env.CI) {
        const result = await getDocBySource('nonexistent');
        expect(result).toBeNull();
      } else {
        mockQuery.mockResolvedValueOnce({
          rows: [],
        });

        const result = await getDocBySource('nonexistent');
        expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM rag_docs WHERE source_unique_id = $1', ['nonexistent']);
        expect(result).toBeNull();
      }
    });
  });

  describe('deleteDoc', () => {
    it('should delete a document and return true', async () => {
      if (process.env.CI) {
        // First insert a test document
        const testDoc: TestDoc = {
          source_type: 'test',
          source_unique_id: 'test123',
          content: 'test content',
          embedding: generateTestVector(),
          metadata: {
            user: 'U1234567890',
            channel: 'C1234567890',
            thread_ts: '1234567890.123456',
            reply_count: 2,
            reactions: [{ name: 'thumbsup', count: 1 }],
            permalink: 'https://slack.com/archives/C1234567890/p1234567890123456',
          },
        };
        await insertOrUpdateDoc(testDoc);

        const result = await deleteDoc('test123');
        expect(result).toBe(true);

        const deletedDoc = await getDocBySource('test123');
        expect(deletedDoc).toBeNull();
      } else {
        mockQuery.mockResolvedValueOnce({
          rows: [{ source_unique_id: 'test123' }],
        });

        const result = await deleteDoc('test123');
        expect(mockQuery).toHaveBeenCalledWith('DELETE FROM rag_docs WHERE source_unique_id = $1 RETURNING *', [
          'test123',
        ]);
        expect(result).toBe(true);
      }
    });

    it('should return false when document not found', async () => {
      if (process.env.CI) {
        const result = await deleteDoc('nonexistent');
        expect(result).toBe(false);
      } else {
        mockQuery.mockResolvedValueOnce({
          rows: [],
        });

        const result = await deleteDoc('nonexistent');
        expect(mockQuery).toHaveBeenCalledWith('DELETE FROM rag_docs WHERE source_unique_id = $1 RETURNING *', [
          'nonexistent',
        ]);
        expect(result).toBe(false);
      }
    });
  });

  describe('findSimilar', () => {
    it('should find similar documents', async () => {
      if (process.env.CI) {
        // First insert test documents
        const testDocs: TestDoc[] = [
          {
            source_type: 'test',
            source_unique_id: 'test1',
            content: 'test content 1',
            embedding: generateTestVector(),
            metadata: {
              user: 'U1234567890',
              channel: 'C1234567890',
              thread_ts: '1234567890.123456',
              reply_count: 2,
              reactions: [{ name: 'thumbsup', count: 1 }],
              permalink: 'https://slack.com/archives/C1234567890/p1234567890123456',
            },
          },
          {
            source_type: 'test',
            source_unique_id: 'test2',
            content: 'test content 2',
            embedding: generateTestVector(1),
            metadata: {
              user: 'U1234567890',
              channel: 'C1234567890',
              thread_ts: '1234567890.123456',
              reply_count: 2,
              reactions: [{ name: 'thumbsup', count: 1 }],
              permalink: 'https://slack.com/archives/C1234567890/p1234567890123456',
            },
          },
        ];
        await Promise.all(testDocs.map((doc) => insertOrUpdateDoc(doc)));

        const result = await findSimilar(generateTestVector(), { limit: 2 });
        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({
          source_type: testDocs[0].source_type,
          source_unique_id: testDocs[0].source_unique_id,
          content: testDocs[0].content,
          metadata: {
            ...testDocs[0].metadata,
            member_name: null,
            member_slack_id: null,
            member_location_tags: null,
            member_linkedin_url: null,
            member_notion_page_url: null,
          },
        });
        expect(result[1]).toMatchObject({
          source_type: testDocs[1].source_type,
          source_unique_id: testDocs[1].source_unique_id,
          content: testDocs[1].content,
          metadata: {
            ...testDocs[1].metadata,
            member_name: null,
            member_slack_id: null,
            member_location_tags: null,
            member_linkedin_url: null,
            member_notion_page_url: null,
          },
        });
      } else {
        const mockDocs = [
          {
            source_type: 'test',
            source_unique_id: 'test1',
            content: 'test content 1',
            embedding: generateTestVector(),
            metadata: {
              user: 'U1234567890',
              channel: 'C1234567890',
              thread_ts: '1234567890.123456',
              reply_count: 2,
              reactions: [{ name: 'thumbsup', count: 1 }],
              permalink: 'https://slack.com/archives/C1234567890/p1234567890123456',
            },
            member_name: null,
            member_slack_id: null,
            member_location_tags: null,
            member_linkedin_url: null,
            member_notion_page_url: null,
            similarity: 0.95,
          },
          {
            source_type: 'test',
            source_unique_id: 'test2',
            content: 'test content 2',
            embedding: generateTestVector(1),
            metadata: {
              user: 'U1234567890',
              channel: 'C1234567890',
              thread_ts: '1234567890.123456',
              reply_count: 2,
              reactions: [{ name: 'thumbsup', count: 1 }],
              permalink: 'https://slack.com/archives/C1234567890/p1234567890123456',
            },
            member_name: null,
            member_slack_id: null,
            member_location_tags: null,
            member_linkedin_url: null,
            member_notion_page_url: null,
            similarity: 0.85,
          },
        ];
        mockQuery.mockResolvedValueOnce({
          rows: mockDocs,
        });

        const result = await findSimilar(generateTestVector(), { limit: 2 });
        expect(mockQuery).toHaveBeenCalledWith(
          `SELECT
        source_type,
        source_unique_id,
        content,
        
        metadata,
        created_at,
        updated_at,
        member_name,
        member_slack_id,
        member_location_tags,
        member_linkedin_url,
        member_notion_page_url,
        1 - (embedding <=> $1) as similarity
      FROM documents_with_member_context
      ORDER BY embedding <=> $1
      LIMIT $2`,
          [`[${generateTestVector().join(',')}]`, 2],
        );
        expect(result).toEqual([
          {
            source_type: 'test',
            source_unique_id: 'test1',
            content: 'test content 1',
            metadata: {
              user: 'U1234567890',
              channel: 'C1234567890',
              thread_ts: '1234567890.123456',
              reply_count: 2,
              reactions: [{ name: 'thumbsup', count: 1 }],
              permalink: 'https://slack.com/archives/C1234567890/p1234567890123456',
              member_name: null,
              member_slack_id: null,
              member_location_tags: null,
              member_linkedin_url: null,
              member_notion_page_url: null,
            },
          },
          {
            source_type: 'test',
            source_unique_id: 'test2',
            content: 'test content 2',
            metadata: {
              user: 'U1234567890',
              channel: 'C1234567890',
              thread_ts: '1234567890.123456',
              reply_count: 2,
              reactions: [{ name: 'thumbsup', count: 1 }],
              permalink: 'https://slack.com/archives/C1234567890/p1234567890123456',
              member_name: null,
              member_slack_id: null,
              member_location_tags: null,
              member_linkedin_url: null,
              member_notion_page_url: null,
            },
          },
        ]);
      }
    });

    it('should include embeddings when excludeEmbeddingsFromResults is false', async () => {
      if (!process.env.CI) {
        const mockDoc = {
          source_type: 'test',
          source_unique_id: 'test1',
          content: 'test content 1',
          embedding: generateTestVector(),
          metadata: {
            user: 'U1234567890',
          },
          member_name: null,
          member_slack_id: null,
          member_location_tags: null,
          member_linkedin_url: null,
          member_notion_page_url: null,
          similarity: 0.95,
        };

        mockQuery.mockResolvedValueOnce({
          rows: [mockDoc],
        });

        const result = await findSimilar(generateTestVector(), {
          limit: 1,
          excludeEmbeddingsFromResults: false,
        });

        expect(mockQuery).toHaveBeenCalledWith(
          `SELECT
        source_type,
        source_unique_id,
        content,
        embedding,
        metadata,
        created_at,
        updated_at,
        member_name,
        member_slack_id,
        member_location_tags,
        member_linkedin_url,
        member_notion_page_url,
        1 - (embedding <=> $1) as similarity
      FROM documents_with_member_context
      ORDER BY embedding <=> $1
      LIMIT $2`,
          [`[${generateTestVector().join(',')}]`, 1],
        );

        expect(result[0]).toEqual({
          source_type: mockDoc.source_type,
          source_unique_id: mockDoc.source_unique_id,
          content: mockDoc.content,
          embedding: mockDoc.embedding,
          metadata: {
            ...mockDoc.metadata,
            member_name: mockDoc.member_name,
            member_slack_id: mockDoc.member_slack_id,
            member_location_tags: mockDoc.member_location_tags,
            member_linkedin_url: mockDoc.member_linkedin_url,
            member_notion_page_url: mockDoc.member_notion_page_url,
          },
        });
      }
    });
  });

  describe('upsertNotionDataForMember', () => {
    const testMemberId = 'test-member-123';
    const testNotionData = {
      notionPageId: 'test-page-123',
      notionPageUrl: 'https://notion.so/test-page-123',
      name: 'Test User',
      linkedinUrl: 'https://linkedin.com/test',
      locationTags: ['New York', 'Remote'],
      expertiseTags: ['Product', 'Design'],
      hiring: true,
      lookingForWork: false,
    };

    beforeEach(async () => {
      if (process.env.CI) {
        // Insert test member in CI mode
        await realClient?.query(
          'INSERT INTO members (officernd_id, name) VALUES ($1, $2) ON CONFLICT (officernd_id) DO UPDATE SET name = $2',
          [testMemberId, testNotionData.name],
        );
      } else {
        // Mock successful member update
        mockQuery.mockImplementation((query: string, params?: QueryParams) => {
          if (query.includes('UPDATE members')) {
            return Promise.resolve({ rows: [{ affected: 1 }] });
          }
          if (query.includes('INSERT INTO rag_docs')) {
            return Promise.resolve({
              rows: [
                {
                  source_type: params?.[0],
                  source_unique_id: params?.[1],
                  content: params?.[2],
                  embedding: null,
                  metadata: params?.[4],
                  created_at: new Date(),
                  updated_at: new Date(),
                },
              ],
            });
          }
          return Promise.resolve({ rows: [] });
        });
      }
    });

    afterEach(async () => {
      if (process.env.CI) {
        // Clean up test member in CI mode
        await realClient?.query('DELETE FROM members WHERE officernd_id = $1', [testMemberId]);
      }
    });

    it('should update member data and create RAG documents', async () => {
      if (process.env.CI) {
        // Test with real database
        await upsertNotionDataForMember(testMemberId, testNotionData);

        // Verify member update
        const memberResult = await realClient?.query(
          'SELECT notion_page_id, location_tags, notion_page_url FROM members WHERE officernd_id = $1',
          [testMemberId],
        );
        expect(memberResult?.rows[0]).toMatchObject({
          notion_page_id: testNotionData.notionPageId,
          location_tags: testNotionData.locationTags,
          notion_page_url: testNotionData.notionPageUrl,
        });

        // Verify expertise document
        const expertiseDoc = await getDocBySource(`officernd_member_${testMemberId}:notion_expertise`);
        expect(expertiseDoc).toMatchObject({
          source_type: 'notion_expertise',
          content: `Expertise and interests: ${testNotionData.expertiseTags.join(', ')}`,
          metadata: expect.objectContaining({
            officernd_member_id: testMemberId,
            notion_page_id: testNotionData.notionPageId,
            tags: testNotionData.expertiseTags,
          }),
        });

        // Verify status document
        const statusDoc = await getDocBySource(`officernd_member_${testMemberId}:notion_status`);
        expect(statusDoc).toMatchObject({
          source_type: 'notion_status',
          content: 'Currently hiring.',
          metadata: expect.objectContaining({
            officernd_member_id: testMemberId,
            notion_page_id: testNotionData.notionPageId,
            hiring: true,
            looking_for_work: false,
          }),
        });
      } else {
        await upsertNotionDataForMember(testMemberId, testNotionData);

        // Verify member update query
        expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE members'), [
          testNotionData.notionPageId,
          testNotionData.locationTags,
          testNotionData.notionPageUrl,
          testNotionData.linkedinUrl,
          testMemberId,
        ]);

        // Verify deletion of old documents
        expect(mockClient.query).toHaveBeenCalledWith(
          expect.stringContaining('DELETE FROM rag_docs'),
          expect.arrayContaining(['notion_%', testMemberId]),
        );

        // Verify expertise document creation
        expect(mockClient.query).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO rag_docs'),
          expect.arrayContaining([
            'notion_expertise',
            `officernd_member_${testMemberId}:notion_expertise`,
            `Expertise and interests: ${testNotionData.expertiseTags.join(', ')}`,
          ]),
        );

        // Verify status document creation
        expect(mockClient.query).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO rag_docs'),
          expect.arrayContaining([
            'notion_status',
            `officernd_member_${testMemberId}:notion_status`,
            'Currently hiring.',
          ]),
        );
      }
    });

    it('should handle members with no expertise or status', async () => {
      const minimalNotionData = {
        ...testNotionData,
        expertiseTags: [],
        hiring: false,
        lookingForWork: false,
      };

      if (process.env.CI) {
        await upsertNotionDataForMember(testMemberId, minimalNotionData);

        // Verify no expertise document was created
        const expertiseDoc = await getDocBySource(`officernd_member_${testMemberId}:notion_expertise`);
        expect(expertiseDoc).toBeNull();

        // Verify no status document was created
        const statusDoc = await getDocBySource(`officernd_member_${testMemberId}:notion_status`);
        expect(statusDoc).toBeNull();
      } else {
        await upsertNotionDataForMember(testMemberId, minimalNotionData);

        // Verify member update still happened
        expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE members'), [
          minimalNotionData.notionPageId,
          minimalNotionData.locationTags,
          minimalNotionData.notionPageUrl,
          minimalNotionData.linkedinUrl,
          testMemberId,
        ]);

        // Verify old documents were still deleted
        expect(mockClient.query).toHaveBeenCalledWith(
          expect.stringContaining('DELETE FROM rag_docs'),
          expect.arrayContaining(['notion_%', testMemberId]),
        );

        // Verify no expertise or status documents were created
        const insertCalls = mockClient.query.mock.calls.filter((call) => call[0].includes('INSERT INTO rag_docs'));
        expect(insertCalls.length).toBe(0);
      }
    });
  });

  describe('updateMembersFromNotion', () => {
    const testNotionMembers = [
      {
        notionPageId: 'page-1',
        notionPageUrl: 'https://notion.so/page-1',
        name: 'Alice Smith',
        linkedinUrl: 'https://linkedin.com/alice',
        locationTags: ['London'],
        expertiseTags: ['Product', 'Design'],
        hiring: true,
        lookingForWork: false,
      },
      {
        notionPageId: 'page-2',
        notionPageUrl: 'https://notion.so/page-2',
        name: 'Bob Jones',
        linkedinUrl: 'https://linkedin.com/bob',
        locationTags: ['Berlin'],
        expertiseTags: ['Engineering', 'AI'],
        hiring: false,
        lookingForWork: true,
      },
    ];

    beforeEach(async () => {
      if (process.env.CI) {
        // Clear members table
        await realClient?.query('DELETE FROM members');
        // Insert test members
        await realClient?.query(
          `INSERT INTO members (officernd_id, name, notion_page_id) 
           VALUES 
           ('member-1', 'Alice Smith', null),
           ('member-2', 'Bob Jones', 'old-page-id'),
           ('member-3', 'Charlie Brown', null)`,
        );
      } else {
        // Mock the members query response
        mockQuery.mockImplementation((query: string) => {
          if (query.includes('SELECT officernd_id, name, notion_page_id FROM members')) {
            return Promise.resolve({
              rows: [
                { officernd_id: 'member-1', name: 'Alice Smith', notion_page_id: null },
                { officernd_id: 'member-2', name: 'Bob Jones', notion_page_id: 'old-page-id' },
                { officernd_id: 'member-3', name: 'Charlie Brown', notion_page_id: null },
              ],
            });
          }
          if (query.includes('UPDATE members')) {
            return Promise.resolve({ rows: [{ affected: 1 }] });
          }
          if (query.includes('INSERT INTO rag_docs')) {
            return Promise.resolve({
              rows: [
                {
                  source_type: 'notion_expertise',
                  source_unique_id: 'test-id',
                  content: 'test content',
                  embedding: null,
                  metadata: {},
                  created_at: new Date(),
                  updated_at: new Date(),
                },
              ],
            });
          }
          return Promise.resolve({ rows: [] });
        });
      }
    });

    it('should match and update members by name and notion ID', async () => {
      if (process.env.CI) {
        await updateMembersFromNotion(testNotionMembers);

        // Verify Alice was matched by name and updated
        const aliceResult = await realClient?.query(
          'SELECT notion_page_id, notion_page_url FROM members WHERE name = $1',
          ['Alice Smith'],
        );
        expect(aliceResult?.rows[0]).toMatchObject({
          notion_page_id: 'page-1',
          notion_page_url: 'https://notion.so/page-1',
        });

        // Verify Bob was matched and updated
        const bobResult = await realClient?.query(
          'SELECT notion_page_id, notion_page_url FROM members WHERE name = $1',
          ['Bob Jones'],
        );
        expect(bobResult?.rows[0]).toMatchObject({
          notion_page_id: 'page-2',
          notion_page_url: 'https://notion.so/page-2',
        });

        // Verify Charlie was not updated
        const charlieResult = await realClient?.query(
          'SELECT notion_page_id, notion_page_url FROM members WHERE name = $1',
          ['Charlie Brown'],
        );
        expect(charlieResult?.rows[0].notion_page_id).toBeNull();
        expect(charlieResult?.rows[0].notion_page_url).toBeNull();
      } else {
        await updateMembersFromNotion(testNotionMembers);

        // Verify the initial members query
        expect(mockQuery).toHaveBeenCalledWith('SELECT officernd_id, name, notion_page_id FROM members');

        // Verify Alice's update
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('UPDATE members'),
          expect.arrayContaining(['page-1', ['London'], 'https://notion.so/page-1', 'member-1']),
        );

        // Verify Bob's update
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('UPDATE members'),
          expect.arrayContaining(['page-2', ['Berlin'], 'https://notion.so/page-2', 'member-2']),
        );

        // Verify RAG documents were created for both members
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO rag_docs'),
          expect.arrayContaining([
            'notion_expertise',
            expect.stringContaining('member-1'),
            expect.stringContaining('Product, Design'),
          ]),
        );
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO rag_docs'),
          expect.arrayContaining([
            'notion_expertise',
            expect.stringContaining('member-2'),
            expect.stringContaining('Engineering, AI'),
          ]),
        );
      }
    });

    it('should handle empty notion members array', async () => {
      if (process.env.CI) {
        await updateMembersFromNotion([]);

        // Verify no changes were made to the members table
        const result = await realClient?.query('SELECT * FROM members');
        expect(result?.rows).toHaveLength(3);
        expect(result?.rows.every((row) => row.notion_page_url === null)).toBe(true);
      } else {
        await updateMembersFromNotion([]);

        // Verify only the initial members query was made
        expect(mockQuery).toHaveBeenCalledTimes(1);
        expect(mockQuery).toHaveBeenCalledWith('SELECT officernd_id, name, notion_page_id FROM members');
      }
    });

    it('should handle unmatched notion members gracefully', async () => {
      const unmatchedMember = {
        notionPageId: 'page-3',
        notionPageUrl: 'https://notion.so/page-3',
        name: 'Unknown User',
        linkedinUrl: null,
        locationTags: [],
        expertiseTags: [],
        hiring: false,
        lookingForWork: false,
      };

      if (process.env.CI) {
        await updateMembersFromNotion([unmatchedMember]);

        // Verify no changes were made to the members table
        const result = await realClient?.query('SELECT * FROM members WHERE notion_page_id = $1', ['page-3']);
        expect(result?.rows).toHaveLength(0);
      } else {
        await updateMembersFromNotion([unmatchedMember]);

        // Verify only the initial members query was made
        expect(mockQuery).toHaveBeenCalledTimes(1);
        expect(mockQuery).toHaveBeenCalledWith('SELECT officernd_id, name, notion_page_id FROM members');

        // Verify no update queries were made
        const updateCalls = mockQuery.mock.calls.filter((call) => call[0].includes('UPDATE members'));
        expect(updateCalls.length).toBe(0);
      }
    });
  });
});
