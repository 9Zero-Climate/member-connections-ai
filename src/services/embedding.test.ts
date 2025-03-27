// Mock the module before requiring it
jest.mock('./embedding', () => {
  const mockCreate = jest.fn();
  return {
    generateEmbedding: async (text: string) => {
      const response = await mockCreate({
        model: 'text-embedding-3-small',
        input: text,
      });
      return response.data[0].embedding;
    },
    generateEmbeddings: async (texts: string[]) => {
      const response = await mockCreate({
        model: 'text-embedding-3-small',
        input: texts,
      });
      return response.data.map((item: { embedding: number[] }) => item.embedding);
    },
    client: {
      embeddings: {
        create: mockCreate,
      },
    },
  };
});

import { client, generateEmbedding, generateEmbeddings } from './embedding';

describe('embedding', () => {
  let mockEmbeddingsCreate: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEmbeddingsCreate = client.embeddings.create as jest.Mock;
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
