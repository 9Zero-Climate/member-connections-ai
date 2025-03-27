const { retrieveRelevantDocs, formatDocsForContext } = require('./rag');
const { generateEmbedding } = require('./embedding');
const { findSimilar } = require('./database');

// Mock dependencies
jest.mock('./embedding');
jest.mock('./database');

describe('rag', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('retrieveRelevantDocs', () => {
        it('should retrieve relevant documents for a query', async () => {
            const mockQuery = 'test query';
            const mockEmbedding = [0.1, 0.2, 0.3];
            const mockDocs = [
                { content: 'doc1', metadata: { user: 'user1' } },
                { content: 'doc2', metadata: { user: 'user2' } },
            ];

            generateEmbedding.mockResolvedValue(mockEmbedding);
            findSimilar.mockResolvedValue(mockDocs);

            const result = await retrieveRelevantDocs(mockQuery, { limit: 2 });

            expect(generateEmbedding).toHaveBeenCalledWith(mockQuery);
            expect(findSimilar).toHaveBeenCalledWith(mockEmbedding, { limit: 2 });
            expect(result).toEqual(mockDocs);
        });

        it('should handle errors gracefully', async () => {
            const mockError = new Error('Test error');
            generateEmbedding.mockRejectedValue(mockError);

            await expect(retrieveRelevantDocs('test')).rejects.toThrow(mockError);
        });
    });

    describe('formatDocsForContext', () => {
        it('should format documents with metadata', () => {
            const docs = [
                { content: 'doc1', metadata: { user: 'user1' } },
                { content: 'doc2', metadata: { user: 'user2' } },
            ];

            const result = formatDocsForContext(docs);

            expect(result).toBe(
                'Content: doc1\nMetadata: {"user":"user1"}\n\nContent: doc2\nMetadata: {"user":"user2"}\n'
            );
        });

        it('should format documents without metadata', () => {
            const docs = [
                { content: 'doc1' },
                { content: 'doc2' },
            ];

            const result = formatDocsForContext(docs);

            expect(result).toBe('Content: doc1\n\nContent: doc2\n');
        });
    });
}); 