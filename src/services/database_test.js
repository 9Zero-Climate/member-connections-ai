const { insertDoc, getDocBySource, updateDoc, deleteDoc, findSimilar, close, setTestClient } = require('./database');
const { Client } = require('pg');

// Mock pg Client
jest.mock('pg', () => ({
    Client: jest.fn().mockImplementation(() => ({
        connect: jest.fn().mockResolvedValue(),
        query: jest.fn().mockResolvedValue({ rows: [] }),
        end: jest.fn().mockResolvedValue(),
    })),
}));

describe('database', () => {
    let mockClient;
    let mockQuery;

    beforeEach(() => {
        jest.clearAllMocks();
        mockClient = new Client();
        mockQuery = mockClient.query;
        setTestClient(mockClient);
    });

    describe('insertDoc', () => {
        it('should insert a document and return it', async () => {
            const mockDoc = {
                source_type: 'test',
                source_unique_id: 'test123',
                content: 'test content',
                embedding: [0.1, 0.2, 0.3],
            };
            mockQuery.mockResolvedValueOnce({
                rows: [mockDoc]
            });

            const result = await insertDoc(mockDoc);

            expect(mockQuery).toHaveBeenCalledWith(
                'INSERT INTO rag_docs (source_type, source_unique_id, content, embedding) VALUES ($1, $2, $3, $4) RETURNING *',
                [mockDoc.source_type, mockDoc.source_unique_id, mockDoc.content, JSON.stringify(mockDoc.embedding)]
            );
            expect(result).toEqual(mockDoc);
        });
    });

    describe('getDocBySource', () => {
        it('should return a document when found', async () => {
            const mockDoc = {
                source_type: 'test',
                source_unique_id: 'test123',
                content: 'test content',
                embedding: [0.1, 0.2, 0.3],
            };
            mockQuery.mockResolvedValueOnce({
                rows: [mockDoc]
            });

            const result = await getDocBySource('test123');

            expect(mockQuery).toHaveBeenCalledWith(
                'SELECT * FROM rag_docs WHERE source_unique_id = $1',
                ['test123']
            );
            expect(result).toEqual(mockDoc);
        });

        it('should return null when document not found', async () => {
            mockQuery.mockResolvedValueOnce({
                rows: []
            });

            const result = await getDocBySource('nonexistent');

            expect(mockQuery).toHaveBeenCalledWith(
                'SELECT * FROM rag_docs WHERE source_unique_id = $1',
                ['nonexistent']
            );
            expect(result).toBeNull();
        });
    });

    describe('updateDoc', () => {
        it('should update document content and embedding', async () => {
            const mockDoc = {
                source_type: 'test',
                source_unique_id: 'test123',
                content: 'updated content',
                embedding: [0.4, 0.5, 0.6],
            };
            mockQuery.mockResolvedValueOnce({
                rows: [mockDoc]
            });

            const result = await updateDoc('test123', {
                content: 'updated content',
                embedding: [0.4, 0.5, 0.6],
            });

            expect(mockQuery).toHaveBeenCalledWith(
                'UPDATE rag_docs SET content = $1, embedding = $2 WHERE source_unique_id = $3 RETURNING *',
                ['updated content', JSON.stringify([0.4, 0.5, 0.6]), 'test123']
            );
            expect(result).toEqual(mockDoc);
        });
    });

    describe('deleteDoc', () => {
        it('should delete a document and return true', async () => {
            mockQuery.mockResolvedValueOnce({
                rows: [{ id: 1 }]
            });

            const result = await deleteDoc('test123');

            expect(mockQuery).toHaveBeenCalledWith(
                'DELETE FROM rag_docs WHERE source_unique_id = $1 RETURNING *',
                ['test123']
            );
            expect(result).toBe(true);
        });

        it('should return false when document not found', async () => {
            mockQuery.mockResolvedValueOnce({
                rows: []
            });

            const result = await deleteDoc('nonexistent');

            expect(mockQuery).toHaveBeenCalledWith(
                'DELETE FROM rag_docs WHERE source_unique_id = $1 RETURNING *',
                ['nonexistent']
            );
            expect(result).toBe(false);
        });
    });

    describe('findSimilar', () => {
        it('should find similar documents using vector similarity', async () => {
            const mockDocs = [
                { id: 1, content: 'doc1', similarity: 0.9 },
                { id: 2, content: 'doc2', similarity: 0.8 },
            ];
            mockQuery.mockResolvedValueOnce({
                rows: mockDocs
            });

            const result = await findSimilar([0.1, 0.2, 0.3], { limit: 2 });

            expect(mockQuery).toHaveBeenCalledWith(
                `SELECT *, 1 - (embedding <=> $1) as similarity
             FROM rag_docs
             ORDER BY embedding <=> $1
             LIMIT $2`,
                [JSON.stringify([0.1, 0.2, 0.3]), 2]
            );
            expect(result).toEqual(mockDocs);
        });

        it('should use default limit of 5', async () => {
            mockQuery.mockResolvedValueOnce({
                rows: []
            });

            await findSimilar([0.1, 0.2, 0.3]);

            expect(mockQuery).toHaveBeenCalledWith(
                `SELECT *, 1 - (embedding <=> $1) as similarity
             FROM rag_docs
             ORDER BY embedding <=> $1
             LIMIT $2`,
                [JSON.stringify([0.1, 0.2, 0.3]), 5]
            );
        });
    });

    describe('close', () => {
        it('should close the database connection', async () => {
            await close();
            expect(mockClient.end).toHaveBeenCalled();
        });
    });
}); 