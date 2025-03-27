const { generateEmbedding, generateEmbeddings, client } = require('./embedding');

// No need to mock the entire OpenAI module
jest.mock('openai', () => ({
  OpenAI: jest.fn(),
}));

describe('embedding', () => {
  let mockEmbeddingsCreate;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEmbeddingsCreate = jest.fn();
    // Mock the client's embeddings.create method
    client.embeddings = { create: mockEmbeddingsCreate };
  });

  describe('generateEmbedding', () => {
    it('should generate embedding for a single text', async () => {
      const mockEmbedding = [0.1, 0.2, 0.3];
      mockEmbeddingsCreate.mockResolvedValueOnce({
        data: [{ embedding: mockEmbedding }],
      });

      const result = await generateEmbedding('test text');

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: 'test text',
      });
      expect(result).toEqual(mockEmbedding);
    });

    it('should handle errors', async () => {
      const error = new Error('API error');
      mockEmbeddingsCreate.mockRejectedValueOnce(error);

      await expect(generateEmbedding('test text')).rejects.toThrow('API error');
      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: 'test text',
      });
    });
  });

  describe('generateEmbeddings', () => {
    it('should generate embeddings for multiple texts', async () => {
      const mockEmbeddings = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ];
      mockEmbeddingsCreate.mockResolvedValueOnce({
        data: mockEmbeddings.map((embedding) => ({ embedding })),
      });

      const result = await generateEmbeddings(['text1', 'text2']);

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: ['text1', 'text2'],
      });
      expect(result).toEqual(mockEmbeddings);
    });

    it('should handle errors', async () => {
      const error = new Error('API error');
      mockEmbeddingsCreate.mockRejectedValueOnce(error);

      await expect(generateEmbeddings(['text1', 'text2'])).rejects.toThrow('API error');
      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: ['text1', 'text2'],
      });
    });
  });
});
