const database = require('./database');
const { Pool } = require('pg');

// Mock pg Pool
jest.mock('pg', () => {
    const mPool = {
        query: jest.fn(),
        end: jest.fn(),
    };
    return { Pool: jest.fn(() => mPool) };
});

describe('database', () => {
    let mockPool;
    const mockEmbedding = [0.1, 0.2, 0.3];
    const mockDoc = {
        source_type: 'slack',
        source_unique_id: 'C123:1234567890.123456',
        content: 'Test message',
        embedding: mockEmbedding,
    };

    beforeEach(() => {
        // Clear all mocks before each test
        jest.clearAllMocks();
        mockPool = new Pool();
    });

    afterAll(async () => {
        await database.close();
    });

    describe('insertDoc', () => {
        it('should insert a document and return it', async () => {
            const mockResult = {
                rows: [{ id: 1, ...mockDoc, created_at: new Date() }],
            };
            mockPool.query.mockResolvedValueOnce(mockResult);

            const result = await database.insertDoc(mockDoc);

            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO rag_docs'),
                [mockDoc.source_type, mockDoc.source_unique_id, mockDoc.content, mockDoc.embedding]
            );
            expect(result).toEqual(mockResult.rows[0]);
        });
    });

    describe('getDocBySource', () => {
        it('should return a document when found', async () => {
            const mockResult = {
                rows: [{ id: 1, ...mockDoc, created_at: new Date() }],
            };
            mockPool.query.mockResolvedValueOnce(mockResult);

            const result = await database.getDocBySource(
                mockDoc.source_type,
                mockDoc.source_unique_id
            );

            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT * FROM rag_docs'),
                [mockDoc.source_type, mockDoc.source_unique_id]
            );
            expect(result).toEqual(mockResult.rows[0]);
        });

        it('should return null when document not found', async () => {
            mockPool.query.mockResolvedValueOnce({ rows: [] });

            const result = await database.getDocBySource(
                mockDoc.source_type,
                mockDoc.source_unique_id
            );

            expect(result).toBeNull();
        });
    });

    describe('updateDoc', () => {
        it('should update document content and embedding', async () => {
            const newContent = 'Updated content';
            const newEmbedding = [0.4, 0.5, 0.6];
            const mockResult = {
                rows: [{
                    id: 1,
                    ...mockDoc,
                    content: newContent,
                    embedding: newEmbedding,
                    created_at: new Date(),
                    updated_at: new Date()
                }],
            };
            mockPool.query.mockResolvedValueOnce(mockResult);

            const result = await database.updateDoc(1, newContent, newEmbedding);

            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE rag_docs'),
                [newContent, newEmbedding, 1]
            );
            expect(result).toEqual(mockResult.rows[0]);
        });
    });

    describe('deleteDoc', () => {
        it('should delete a document and return true', async () => {
            mockPool.query.mockResolvedValueOnce({ rowCount: 1 });

            const result = await database.deleteDoc(1);

            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM rag_docs'),
                [1]
            );
            expect(result).toBe(true);
        });

        it('should return false when document not found', async () => {
            mockPool.query.mockResolvedValueOnce({ rowCount: 0 });

            const result = await database.deleteDoc(1);

            expect(result).toBe(false);
        });
    });

    describe('findSimilar', () => {
        it('should find similar documents using vector similarity', async () => {
            const mockResults = {
                rows: [
                    { id: 1, ...mockDoc, similarity: 0.95 },
                    { id: 2, ...mockDoc, similarity: 0.85 },
                ],
            };
            mockPool.query.mockResolvedValueOnce(mockResults);

            const results = await database.findSimilar(mockEmbedding, 2);

            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT *, 1 - (embedding <=> $1) as similarity'),
                [mockEmbedding, 2]
            );
            expect(results).toEqual(mockResults.rows);
        });

        it('should use default limit of 5', async () => {
            mockPool.query.mockResolvedValueOnce({ rows: [] });

            await database.findSimilar(mockEmbedding);

            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT *, 1 - (embedding <=> $1) as similarity'),
                [mockEmbedding, 5]
            );
        });
    });

    describe('close', () => {
        it('should close the database connection', async () => {
            await database.close();
            expect(mockPool.end).toHaveBeenCalled();
        });
    });
}); 