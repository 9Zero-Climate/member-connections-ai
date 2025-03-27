const { insertDoc, getDocBySource, updateDoc, deleteDoc, findSimilar, close, setTestClient } = require('./database');
const { Client } = require('pg');

describe('database', () => {
  let mockClient;
  let mockQuery;
  let realClient;

  beforeEach(async () => {
    jest.clearAllMocks();

    if (process.env.CI) {
      // In CI, use real database
      realClient = new Client({
        connectionString: process.env.DB_URL,
      });
      await realClient.connect();
      setTestClient(realClient);

      // Clear the table before each test
      await realClient.query('DELETE FROM rag_docs');
    } else {
      // In local development, use mocks
      mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
        connect: jest.fn().mockResolvedValue(),
        end: jest.fn().mockResolvedValue(),
      };
      setTestClient(mockClient);
      mockQuery = mockClient.query;
    }
  });

  afterEach(async () => {
    if (process.env.CI && realClient) {
      await realClient.end();
    }
  });

  describe('insertDoc', () => {
    it('should insert a document and return it', async () => {
      const testDoc = {
        source_type: 'test',
        source_unique_id: 'test123',
        content: 'test content',
        embedding: [0.1, 0.2, 0.3],
      };

      if (process.env.CI) {
        const result = await insertDoc(testDoc);
        expect(result).toMatchObject({
          source_type: testDoc.source_type,
          source_unique_id: testDoc.source_unique_id,
          content: testDoc.content,
        });
        expect(result.embedding).toBeDefined();
      } else {
        mockQuery.mockResolvedValueOnce({
          rows: [testDoc],
        });

        const result = await insertDoc(testDoc);

        expect(mockQuery).toHaveBeenCalledWith(
          'INSERT INTO rag_docs (source_type, source_unique_id, content, embedding) VALUES ($1, $2, $3, $4) RETURNING *',
          [testDoc.source_type, testDoc.source_unique_id, testDoc.content, JSON.stringify(testDoc.embedding)],
        );
        expect(result).toEqual(testDoc);
      }
    });
  });

  describe('getDocBySource', () => {
    it('should return a document when found', async () => {
      if (process.env.CI) {
        // First insert a test document
        const testDoc = {
          source_type: 'test',
          source_unique_id: 'test123',
          content: 'test content',
          embedding: [0.1, 0.2, 0.3],
        };
        await insertDoc(testDoc);

        const result = await getDocBySource('test123');
        expect(result).toMatchObject({
          source_type: testDoc.source_type,
          source_unique_id: testDoc.source_unique_id,
          content: testDoc.content,
        });
        expect(result.embedding).toBeDefined();
      } else {
        const mockDoc = {
          source_type: 'test',
          source_unique_id: 'test123',
          content: 'test content',
          embedding: [0.1, 0.2, 0.3],
        };
        mockQuery.mockResolvedValueOnce({
          rows: [mockDoc],
        });

        const result = await getDocBySource('test123');
        expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM rag_docs WHERE source_unique_id = $1', ['test123']);
        expect(result).toEqual(mockDoc);
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
        const testDoc = {
          source_type: 'test',
          source_unique_id: 'test123',
          content: 'test content',
          embedding: [0.1, 0.2, 0.3],
        };
        await insertDoc(testDoc);

        const update = {
          content: 'updated content',
          embedding: [0.4, 0.5, 0.6],
        };

        const result = await updateDoc('test123', update);
        expect(result).toMatchObject({
          source_type: testDoc.source_type,
          source_unique_id: testDoc.source_unique_id,
          content: update.content,
        });
        expect(result.embedding).toBeDefined();
      } else {
        const mockDoc = {
          source_type: 'test',
          source_unique_id: 'test123',
          content: 'updated content',
          embedding: [0.4, 0.5, 0.6],
        };
        mockQuery.mockResolvedValueOnce({
          rows: [mockDoc],
        });

        const result = await updateDoc('test123', {
          content: 'updated content',
          embedding: [0.4, 0.5, 0.6],
        });

        expect(mockQuery).toHaveBeenCalledWith(
          'UPDATE rag_docs SET content = $1, embedding = $2 WHERE source_unique_id = $3 RETURNING *',
          ['updated content', JSON.stringify([0.4, 0.5, 0.6]), 'test123'],
        );
        expect(result).toEqual(mockDoc);
      }
    });
  });

  describe('deleteDoc', () => {
    it('should delete a document and return true', async () => {
      if (process.env.CI) {
        // First insert a test document
        const testDoc = {
          source_type: 'test',
          source_unique_id: 'test123',
          content: 'test content',
          embedding: [0.1, 0.2, 0.3],
        };
        await insertDoc(testDoc);

        const result = await deleteDoc('test123');
        expect(result).toBe(true);

        // Verify it's deleted
        const deleted = await getDocBySource('test123');
        expect(deleted).toBeNull();
      } else {
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: 1 }],
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
    it('should find similar documents using vector similarity', async () => {
      if (process.env.CI) {
        // Insert test documents
        const docs = [
          {
            source_type: 'test',
            source_unique_id: 'test1',
            content: 'doc1',
            embedding: [0.1, 0.2, 0.3],
          },
          {
            source_type: 'test',
            source_unique_id: 'test2',
            content: 'doc2',
            embedding: [0.2, 0.3, 0.4],
          },
        ];
        await Promise.all(docs.map(doc => insertDoc(doc)));

        const result = await findSimilar([0.1, 0.2, 0.3], { limit: 2 });
        expect(result).toHaveLength(2);
        expect(result[0]).toHaveProperty('similarity');
        expect(result[0].similarity).toBeGreaterThan(result[1].similarity);
      } else {
        const mockDocs = [
          { id: 1, content: 'doc1', similarity: 0.9 },
          { id: 2, content: 'doc2', similarity: 0.8 },
        ];
        mockQuery.mockResolvedValueOnce({
          rows: mockDocs,
        });

        const result = await findSimilar([0.1, 0.2, 0.3], { limit: 2 });

        expect(mockQuery).toHaveBeenCalledWith(
          `SELECT *, 1 - (embedding <=> $1) as similarity
             FROM rag_docs
             ORDER BY embedding <=> $1
             LIMIT $2`,
          [JSON.stringify([0.1, 0.2, 0.3]), 2],
        );
        expect(result).toEqual(mockDocs);
      }
    });

    it('should use default limit of 5', async () => {
      if (process.env.CI) {
        // Insert test documents
        const docs = Array.from({ length: 10 }, (_, i) => ({
          source_type: 'test',
          source_unique_id: `test${i}`,
          content: `doc${i}`,
          embedding: [0.1 + i * 0.1, 0.2 + i * 0.1, 0.3 + i * 0.1],
        }));
        await Promise.all(docs.map(doc => insertDoc(doc)));

        const result = await findSimilar([0.1, 0.2, 0.3]);
        expect(result).toHaveLength(5);
      } else {
        mockQuery.mockResolvedValueOnce({
          rows: [],
        });

        await findSimilar([0.1, 0.2, 0.3]);

        expect(mockQuery).toHaveBeenCalledWith(
          `SELECT *, 1 - (embedding <=> $1) as similarity
             FROM rag_docs
             ORDER BY embedding <=> $1
             LIMIT $2`,
          [JSON.stringify([0.1, 0.2, 0.3]), 5],
        );
      }
    });
  });

  describe('close', () => {
    it('should close the database connection', async () => {
      if (process.env.CI) {
        await close();
        // In CI, we can't easily verify the connection was closed
        // but we can verify the function doesn't throw
      } else {
        await close();
        expect(mockClient.end).toHaveBeenCalled();
      }
    });
  });
});
