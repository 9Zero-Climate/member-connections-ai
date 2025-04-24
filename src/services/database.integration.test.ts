import type { Client } from 'pg';
import { mockEmbeddingsService } from './mocks';

import {
  deleteDoc,
  findSimilar,
  getDocBySource,
  getOrCreateClient,
  insertOrUpdateDoc,
  updateMembersFromNotion,
} from './database';

jest.mock('./embedding', () => mockEmbeddingsService);

const VECTOR_DIMENSION = 1536;
const generateMockEmbedding = (seed = 0): number[] => {
  return Array.from({ length: VECTOR_DIMENSION }, (_, i) => (i + seed) / VECTOR_DIMENSION);
};

describe('Database Integration Tests', () => {
  const testDoc = {
    source_type: 'test',
    source_unique_id: 'test1',
    content: 'test content 1',
    embedding: generateMockEmbedding(1),
    metadata: {
      user: 'U1234567890',
      channel: 'C1234567890',
      thread_ts: '1234567890.123456',
      reply_count: 2,
      reactions: [{ name: 'thumbsup', count: 1 }],
      permalink: 'https://slack.com/archives/C1234567890/p1234567890123456',
    },
  };

  let testDbClient: Client;

  beforeAll(async () => {
    testDbClient = await getOrCreateClient();
    mockEmbeddingsService.generateEmbeddings.mockImplementation(() => [generateMockEmbedding()]);
  });

  describe('insertOrUpdateDoc', () => {
    it('should insert a document and return it', async () => {
      const result = await insertOrUpdateDoc(testDoc);
      expect(result).toMatchObject({
        source_type: testDoc.source_type,
        source_unique_id: testDoc.source_unique_id,
        content: testDoc.content,
        // embedding: doc.embedding,
        metadata: {},
      });
    });

    it('should update an existing document', async () => {
      const updatedDoc = {
        ...testDoc,
        content: 'updated content',
      };

      const result = await insertOrUpdateDoc(updatedDoc);
      expect(result).toMatchObject({
        source_type: updatedDoc.source_type,
        source_unique_id: updatedDoc.source_unique_id,
        content: updatedDoc.content,
        // embedding: updatedDoc.embedding,
        metadata: {},
      });
    });
  });

  describe('getDocBySource', () => {
    it('should return a document when found', async () => {
      await insertOrUpdateDoc(testDoc);

      const result = await getDocBySource(testDoc.source_unique_id);
      expect(result).toMatchObject({
        source_type: testDoc.source_type,
        source_unique_id: testDoc.source_unique_id,
        content: testDoc.content,
        metadata: testDoc.metadata,
      });
      expect(result?.embedding).toBeDefined();
    });

    it('should return null when document not found', async () => {
      const result = await getDocBySource('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('deleteDoc', () => {
    it('should delete a document and return true', async () => {
      // First insert a test document
      const testDoc = {
        source_type: 'test',
        source_unique_id: 'test123',
        content: 'test content',
        embedding: generateMockEmbedding(),
        metadata: {},
      };
      await insertOrUpdateDoc(testDoc);

      const result = await deleteDoc('test123');
      expect(result).toBe(true);

      const deletedDoc = await getDocBySource('test123');
      expect(deletedDoc).toBeNull();
    });

    it('should return false when document not found', async () => {
      const result = await deleteDoc('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('findSimilar', () => {
    const testDoc2 = {
      source_type: 'test',
      source_unique_id: 'test2',
      content: 'test content 2',
      embedding: generateMockEmbedding(2),
      metadata: {
        user: 'U1234567890',
        channel: 'C1234567890',
        thread_ts: '1234567890.123456',
        reply_count: 2,
        reactions: [{ name: 'thumbsup', count: 1 }],
        permalink: 'https://slack.com/archives/C1234567890/p1234567890123456',
      },
    };
    const testDocs = [testDoc, testDoc2];

    beforeAll(async () => {
      await Promise.all(testDocs.map((doc) => insertOrUpdateDoc(doc)));
    });

    it('should find similar documents', async () => {
      const result = await findSimilar(generateMockEmbedding(), { limit: 2 });
      expect(result).toHaveLength(2);
      expect(result[0].source_unique_id).toEqual(testDoc.source_unique_id);
      expect(result[1].source_unique_id).toEqual(testDoc2.source_unique_id);
    });

    it('should exclude embeddings when excludeEmbeddingsFromResults is true', async () => {
      const result = await findSimilar(generateMockEmbedding(), {
        limit: 1,
        excludeEmbeddingsFromResults: true,
      });

      expect(result[0].embedding).toBe(undefined);
    });

    it('should include embeddings when excludeEmbeddingsFromResults is false', async () => {
      const result = await findSimilar(generateMockEmbedding(), {
        limit: 1,
        excludeEmbeddingsFromResults: false,
      });

      expect(result[0].embedding).toBeDefined();
    });
  });

  describe('updateMembersFromNotion', () => {
    const testNotionMembers = [
      {
        notionPageId: 'page-1',
        notionPageUrl: 'https://notion.so/page-1',
        name: 'Alice Smith',
        linkedinUrl: 'https://linkedin.com/alice',
        locationTags: ['London'],
        expertiseTags: ['Product', 'Design'],
        hiring: true,
        lookingForWork: false,
      },
      {
        notionPageId: 'page-2',
        notionPageUrl: 'https://notion.so/page-2',
        name: 'Bob Jones',
        linkedinUrl: 'https://linkedin.com/bob',
        locationTags: ['Berlin'],
        expertiseTags: ['Engineering', 'AI'],
        hiring: false,
        lookingForWork: true,
      },
    ];

    beforeEach(async () => {
      // Clear members table
      await testDbClient.query('DELETE FROM members');
      // Insert test members
      await testDbClient.query(
        `INSERT INTO members (officernd_id, name, notion_page_id) 
           VALUES 
           ('member-1', 'Alice Smith', null),
           ('member-2', 'Bob Jones', 'old-page-id'),
           ('member-3', 'Charlie Brown', null)`,
      );
    });

    it('should match and update members by name and notion ID', async () => {
      await updateMembersFromNotion(testNotionMembers);

      // Verify Alice was matched by name and updated
      const aliceResult = await testDbClient.query(
        'SELECT notion_page_id, notion_page_url FROM members WHERE name = $1',
        ['Alice Smith'],
      );
      expect(aliceResult?.rows[0]).toMatchObject({
        notion_page_id: 'page-1',
        notion_page_url: 'https://notion.so/page-1',
      });

      // Verify Bob was matched and updated
      const bobResult = await testDbClient.query(
        'SELECT notion_page_id, notion_page_url FROM members WHERE name = $1',
        ['Bob Jones'],
      );
      expect(bobResult?.rows[0]).toMatchObject({
        notion_page_id: 'page-2',
        notion_page_url: 'https://notion.so/page-2',
      });

      // Verify Charlie was not updated
      const charlieResult = await testDbClient.query(
        'SELECT notion_page_id, notion_page_url FROM members WHERE name = $1',
        ['Charlie Brown'],
      );
      expect(charlieResult?.rows[0].notion_page_id).toBeNull();
      expect(charlieResult?.rows[0].notion_page_url).toBeNull();
    });

    it('should handle empty notion members array', async () => {
      await updateMembersFromNotion([]);

      // Verify no changes were made to the members table
      const result = await testDbClient.query('SELECT * FROM members');
      expect(result?.rows).toHaveLength(3);
      expect(result?.rows.every((row) => row.notion_page_url === null)).toBe(true);
    });

    it('should handle unmatched notion members gracefully', async () => {
      const unmatchedMember = {
        notionPageId: 'page-3',
        notionPageUrl: 'https://notion.so/page-3',
        name: 'Unknown User',
        linkedinUrl: null,
        locationTags: [],
        expertiseTags: [],
        hiring: false,
        lookingForWork: false,
      };

      await updateMembersFromNotion([unmatchedMember]);

      // Verify no changes were made to the members table
      const result = await testDbClient.query('SELECT * FROM members WHERE notion_page_id = $1', ['page-3']);
      expect(result?.rows).toHaveLength(0);
    });
  });
});
