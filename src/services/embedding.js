const { OpenAI } = require('openai');
const { config } = require('dotenv');

config();

// Internal OpenAI client instance - use a no-op client in test env
const client =
  process.env.NODE_ENV === 'test'
    ? { embeddings: { create: () => ({ data: [{ embedding: [] }] }) } }
    : new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });

/**
 * Generate embeddings for a text using OpenAI's API
 * @param {string} text - The text to generate embeddings for
 * @returns {Promise<number[]>} The embedding vector
 */
async function generateEmbedding(text) {
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
      message: error.message,
      status: error.status,
      type: error.type,
      code: error.code,
      response: error.response?.data,
    });
    throw error;
  }
}

/**
 * Generate embeddings for a batch of texts
 * @param {string[]} texts - Array of texts to generate embeddings for
 * @returns {Promise<number[][]>} Array of embedding vectors
 */
async function generateEmbeddings(texts) {
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
      message: error.message,
      status: error.status,
      type: error.type,
      code: error.code,
      response: error.response?.data,
    });
    throw error;
  }
}

module.exports = {
  generateEmbedding,
  generateEmbeddings,
  client,
};
