import { Client } from 'pg';
import {
  bulkUpsertMembers,
  close,
  deleteDoc,
  deleteLinkedInDocuments,
  findSimilar,
  getDocBySource,
  insertOrUpdateDoc,
  setTestClient,
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
          metadata: null, // PostgreSQL converts undefined to null
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
          metadata: null, // PostgreSQL converts undefined to null
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
            slack_user_id: null,
          },
        });
        expect(result[1]).toMatchObject({
          source_type: testDocs[1].source_type,
          source_unique_id: testDocs[1].source_unique_id,
          content: testDocs[1].content,
          metadata: {
            ...testDocs[1].metadata,
            slack_user_id: null,
          },
        });
      } else {
        const mockDocs: TestDoc[] = [
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
        mockQuery.mockResolvedValueOnce({
          rows: mockDocs.map((doc) => ({
            ...doc,
            slack_user_id: null,
          })),
        });

        const result = await findSimilar(generateTestVector(), { limit: 2 });
        expect(mockQuery).toHaveBeenCalledWith(
          `SELECT
        source_type,
        source_unique_id,
        content,
        embedding,
        metadata,
        created_at,
        updated_at,
        slack_user_id,
        1 - (embedding <=> $1) as similarity
      FROM documents_with_slack_user_id
      ORDER BY embedding <=> $1
      LIMIT $2`,
          [`[${generateTestVector().join(',')}]`, 2],
        );
        expect(result).toEqual(
          mockDocs.map((doc) => ({
            ...doc,
            slack_user_id: null,
            metadata: {
              ...doc.metadata,
              slack_user_id: null,
            },
          })),
        );
      }
    });
  });
});
