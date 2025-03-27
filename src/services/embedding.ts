import { config } from 'dotenv';
import { OpenAI } from 'openai';

config();

interface OpenAIError extends Error {
  status?: number;
  type?: string;
  code?: string;
  response?: {
    data?: unknown;
  };
}

// Internal OpenAI client instance - use a no-op client in test env
const client =
  process.env.NODE_ENV === 'test'
    ? {
        embeddings: {
          create: async () => ({
            data: [{ embedding: new Array(1536).fill(0) }] as const,
          }),
        },
      }
    : new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });

/**
 * Generate embeddings for a text using OpenAI's API
 * @param text - The text to generate embeddings for
 * @returns The embedding vector
 */
async function generateEmbedding(text: string): Promise<number[]> {
  try {
    if (!text || typeof text !== 'string') {
      throw new Error('Invalid text input for embedding generation');
    }

    console.log(`Generating embedding for text: ${text.substring(0, 50)}...`);
    const response = await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });

    return response.data[0].embedding;
  } catch (error) {
    console.error('Error generating embedding:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      status: (error as OpenAIError).status,
      type: (error as OpenAIError).type,
      code: (error as OpenAIError).code,
      response: (error as OpenAIError).response?.data,
    });
    throw error;
  }
}

/**
 * Generate embeddings for a batch of texts
 * @param texts - Array of texts to generate embeddings for
 * @returns Array of embedding vectors
 */
async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  try {
    // Filter out invalid texts
    const validTexts = texts.filter((text) => text && typeof text === 'string');

    if (validTexts.length === 0) {
      throw new Error('No valid texts provided for embedding generation');
    }

    console.log(`Generating embeddings for ${validTexts.length} texts`);
    console.log(`First text sample: ${validTexts[0].substring(0, 50)}...`);

    // Process texts in smaller batches to avoid rate limits
    const BATCH_SIZE = 10;
    const batches = [];
    for (let i = 0; i < validTexts.length; i += BATCH_SIZE) {
      batches.push(validTexts.slice(i, i + BATCH_SIZE));
    }

    const allEmbeddings = [];
    for (const batch of batches) {
      if (batch.length === 0) continue;

      const response = await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: batch,
      });

      allEmbeddings.push(...response.data.map((item) => item.embedding));
    }

    return allEmbeddings;
  } catch (error) {
    console.error('Error generating embeddings:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      status: (error as OpenAIError).status,
      type: (error as OpenAIError).type,
      code: (error as OpenAIError).code,
      response: (error as OpenAIError).response?.data,
    });
    throw error;
  }
}

export { generateEmbedding, generateEmbeddings, client };
