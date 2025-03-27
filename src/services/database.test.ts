import { Client } from 'pg';
import {
  SearchOptions,
  type TestClient,
  close,
  deleteDoc,
  findSimilar,
  getDocBySource,
  insertDoc,
  setTestClient,
  updateDoc,
} from './database';

interface TestDoc {
  source_type: string;
  source_unique_id: string;
  content: string;
  embedding: number[];
  metadata: {
    user: string;
    channel: string;
    thread_ts: string;
    reply_count: number;
    reactions: Array<{ name: string; count: number }>;
    permalink: string;
  };
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
        query: jest.fn().mockResolvedValue({ rows: [] }),
        connect: jest.fn().mockResolvedValue(undefined),
        end: jest.fn().mockResolvedValue(undefined),
      } as unknown as TestClient;
      setTestClient(mockClient);
      mockQuery = mockClient.query as jest.Mock;
    }
  });

  afterEach(async () => {
    if (process.env.CI && realClient) {
      await realClient.end();
    }
  });

  describe('insertDoc', () => {
    it('should insert a document and return it', async () => {
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

      if (process.env.CI) {
        const result = await insertDoc(testDoc);
        expect(result).toMatchObject({
          source_type: testDoc.source_type,
          source_unique_id: testDoc.source_unique_id,
          content: testDoc.content,
          metadata: testDoc.metadata,
        });
        expect(result.embedding).toBeDefined();
      } else {
        mockQuery.mockResolvedValueOnce({
          rows: [testDoc],
        });

        const result = await insertDoc(testDoc);

        expect(mockQuery).toHaveBeenCalledWith(
          'INSERT INTO rag_docs (source_type, source_unique_id, content, embedding, metadata) VALUES ($1, $2, $3, $4, $5) RETURNING *',
          [
            testDoc.source_type,
            testDoc.source_unique_id,
            testDoc.content,
            `[${testDoc.embedding.join(',')}]`,
            testDoc.metadata,
          ],
        );
        expect(result).toEqual(testDoc);
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
        await insertDoc(testDoc);

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

  describe('updateDoc', () => {
    it('should update document content and embedding', async () => {
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
        await insertDoc(testDoc);

        const update = {
          content: 'updated content',
          embedding: generateTestVector(1),
          metadata: {
            ...testDoc.metadata,
            reply_count: 3,
            reactions: [{ name: 'thumbsup', count: 2 }],
          },
        };

        const result = await updateDoc('test123', update);
        expect(result).toMatchObject({
          source_type: testDoc.source_type,
          source_unique_id: testDoc.source_unique_id,
          content: update.content,
          metadata: update.metadata,
        });
        expect(result.embedding).toBeDefined();
      } else {
        const mockDoc: TestDoc = {
          source_type: 'test',
          source_unique_id: 'test123',
          content: 'updated content',
          embedding: generateTestVector(1),
          metadata: {
            user: 'U1234567890',
            channel: 'C1234567890',
            thread_ts: '1234567890.123456',
            reply_count: 3,
            reactions: [{ name: 'thumbsup', count: 2 }],
            permalink: 'https://slack.com/archives/C1234567890/p1234567890123456',
          },
        };
        mockQuery.mockResolvedValueOnce({
          rows: [mockDoc],
        });

        const result = await updateDoc('test123', {
          content: 'updated content',
          embedding: generateTestVector(1),
          metadata: mockDoc.metadata,
        });

        expect(mockQuery).toHaveBeenCalledWith(
          'UPDATE rag_docs SET content = $1, embedding = $2, metadata = $3 WHERE source_unique_id = $4 RETURNING *',
          ['updated content', `[${generateTestVector(1).join(',')}]`, mockDoc.metadata, 'test123'],
        );
        expect(result).toEqual(mockDoc);
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
        await insertDoc(testDoc);

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
        await Promise.all(testDocs.map((doc) => insertDoc(doc)));

        const result = await findSimilar(generateTestVector(), { limit: 2 });
        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({
          source_type: testDocs[0].source_type,
          source_unique_id: testDocs[0].source_unique_id,
          content: testDocs[0].content,
          metadata: testDocs[0].metadata,
        });
        expect(result[1]).toMatchObject({
          source_type: testDocs[1].source_type,
          source_unique_id: testDocs[1].source_unique_id,
          content: testDocs[1].content,
          metadata: testDocs[1].metadata,
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
          rows: mockDocs,
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
        1 - (embedding <=> $1) as similarity
      FROM rag_docs
      ORDER BY embedding <=> $1
      LIMIT $2`,
          [`[${generateTestVector().join(',')}]`, 2],
        );
        expect(result).toEqual(mockDocs);
      }
    });
  });
});
