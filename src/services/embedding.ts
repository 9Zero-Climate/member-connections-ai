import { OpenAI } from 'openai';
import { config } from '../config';
import { logger } from './logger';

interface OpenAIError extends Error {
  status?: number;
  type?: string;
  code?: string;
  response?: {
    data?: unknown;
  };
}

// Configure client for direct OpenAI access
// Note: We cannot use OpenRouter here because it does not support embedding generation (2025-04-07)
const client = new OpenAI({
  apiKey: config.openaiApiKey, // Use dedicated OpenAI key
  // baseURL is not set, defaults to OpenAI
});

/**
 * Generate embedding for a single text
 * @param text - The text to generate embedding for
 * @returns Embedding vector
 */
async function generateEmbedding(text: string): Promise<number[]> {
  try {
    if (!text || typeof text !== 'string') {
      throw new Error('Invalid input text');
    }
    logger.debug(`Generating embedding for text: ${text.substring(0, 50)}...`);
    const response = await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });

    return response.data[0].embedding;
  } catch (error) {
    logger.error('Error generating embedding:', {
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
    const validTexts = texts.filter((text) => text && typeof text === 'string');
    if (validTexts.length === 0) {
      return [];
    }
    logger.debug(`Generating embeddings for ${validTexts.length} texts`);
    logger.debug(`First text sample: ${validTexts[0].substring(0, 50)}...`);

    const BATCH_SIZE = 10;
    const batches = [];
    for (let i = 0; i < validTexts.length; i += BATCH_SIZE) {
      batches.push(validTexts.slice(i, i + BATCH_SIZE));
    }

    const allEmbeddings = [];
    for (const batch of batches) {
      if (batch.length === 0) continue;
      const response = await client.embeddings.create({
        model: 'text-embedding-3-small', // No prefix needed for direct OpenAI
        input: batch,
      });
      allEmbeddings.push(...response.data.map((item) => item.embedding));
    }
    return allEmbeddings;
  } catch (error) {
    logger.error('Error generating embeddings:', {
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
