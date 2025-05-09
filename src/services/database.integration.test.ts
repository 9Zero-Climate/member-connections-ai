import type { Client } from 'pg';
import { mockEmbeddingsService } from './mocks';

import type { DocumentWithMemberContext } from './database';
import {
  OfficeLocation,
  bulkUpsertMembers,
  deleteDoc,
  findSimilar,
  getDocBySource,
  getLinkedInDocumentsByMemberIdentifier,
  getOrCreateClient,
  insertOrUpdateDoc,
  updateMember,
  updateMembersFromNotion,
} from './database';
import { normalizeLinkedInUrl } from './linkedin';

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
      const result = await findSimilar(generateMockEmbedding(1), { limit: 2 });
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

  describe('updateMember', () => {
    beforeEach(async () => {
      // Clear members table
      await testDbClient.query('DELETE FROM members');
      // Insert test member
      await testDbClient.query(
        `INSERT INTO members (officernd_id, name, location) 
           VALUES 
           ('member-1', 'Alice Smith', 'Seattle')
        `,
      );
    });

    it('finds and updates member', async () => {
      const updates = {
        name: 'Alice Smith',
        slack_id: null,
        linkedin_url: null,
        notion_page_id: null,
        notion_page_url: null,
        location: OfficeLocation.SAN_FRANCISCO,
        checkin_location_today: null,
      };
      const updatedMember = await updateMember('member-1', updates);

      expect(updatedMember).toEqual({
        officernd_id: 'member-1',
        name: 'Alice Smith',
        slack_id: null,
        linkedin_url: null,
        notion_page_id: null,
        notion_page_url: null,
        location: OfficeLocation.SAN_FRANCISCO,
        checkin_location_today: null,
        created_at: expect.any(Date),
        updated_at: expect.any(Date),
      });
    });

    it('does not overwrite existing attributes with missing attributes', async () => {
      const updates = {};
      const updatedMember = await updateMember('member-1', updates);

      expect(updatedMember).toMatchObject({
        officernd_id: 'member-1',
        location: OfficeLocation.SEATTLE,
      });
    });

    it('overwrites existing attributes with null', async () => {
      const updates = {
        location: null,
      };
      const updatedMember = await updateMember('member-1', updates);

      expect(updatedMember).toMatchObject({
        officernd_id: 'member-1',
        location: null,
      });
    });

    it('errors if no matching member', async () => {
      await expect(updateMember('member-100', {})).rejects.toThrow();
    });
  });

  describe('updateMembersFromNotion', () => {
    const testNotionMembers = [
      {
        notionPageId: 'page-1',
        notionPageUrl: 'https://notion.so/page-1',
        name: 'Alice Smith',
        linkedinUrl: 'https://linkedin.com/in/alice',
        expertiseTags: ['Product', 'Design'],
        hiring: true,
        lookingForWork: false,
      },
      {
        notionPageId: 'page-2',
        notionPageUrl: 'https://notion.so/page-2',
        name: 'Bob Jones',
        linkedinUrl: 'https://linkedin.com/in/bob',
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
        `INSERT INTO members (officernd_id, name, notion_page_id, linkedin_url) 
           VALUES 
           ('member-1', 'Alice Smith', null, null),
           ('member-2', 'Bob Jones', 'old-page-id', null),
           ('member-3', 'Charlie Brown', null, 'https://linkedin.com/in/charlie')
        `,
      );
    });

    it('should match and update members by name and notion ID', async () => {
      await updateMembersFromNotion(testNotionMembers);

      // Verify Alice was matched by name and updated
      const aliceResult = await testDbClient.query(
        'SELECT notion_page_id, notion_page_url, linkedin_url FROM members WHERE name = $1',
        ['Alice Smith'],
      );
      expect(aliceResult?.rows[0]).toMatchObject({
        notion_page_id: 'page-1',
        notion_page_url: 'https://notion.so/page-1',
        linkedin_url: 'https://linkedin.com/in/alice',
      });

      // Verify Bob was matched and updated
      const bobResult = await testDbClient.query(
        'SELECT notion_page_id, notion_page_url, linkedin_url FROM members WHERE name = $1',
        ['Bob Jones'],
      );
      expect(bobResult?.rows[0]).toMatchObject({
        notion_page_id: 'page-2',
        notion_page_url: 'https://notion.so/page-2',
        linkedin_url: 'https://linkedin.com/in/bob',
      });

      // Verify Charlie was not updated
      const charlieResult = await testDbClient.query(
        'SELECT notion_page_id, notion_page_url FROM members WHERE name = $1',
        ['Charlie Brown'],
      );
      expect(charlieResult?.rows[0].notion_page_id).toBeNull();
      expect(charlieResult?.rows[0].notion_page_url).toBeNull();
    });

    // Ticket to remove Notion sync entirely: https://github.com/9Zero-Climate/member-connections-ai/issues/91
    it('should not overwrite existing linkedin_url', async () => {
      await updateMembersFromNotion([
        {
          notionPageId: 'page-3',
          notionPageUrl: 'https://notion.so/page-3',
          name: 'Charlie Brown',
          linkedinUrl: 'https://linkedin.com/in/thewrongcharlie',
          expertiseTags: [],
          hiring: false,
          lookingForWork: false,
        },
      ]);

      // Verify Charlie was not updated
      const charlieResult = await testDbClient.query(
        'SELECT notion_page_id, notion_page_url, linkedin_url FROM members WHERE name = $1',
        ['Charlie Brown'],
      );

      expect(charlieResult?.rows[0]).toMatchObject({
        notion_page_id: 'page-3',
        notion_page_url: 'https://notion.so/page-3',
        linkedin_url: 'https://linkedin.com/in/charlie',
      });
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

  describe('bulkUpsertMembers', () => {
    beforeEach(async () => {
      // Clear members table
      await testDbClient.query('DELETE FROM members');
      // Insert test members
      await testDbClient.query(
        `INSERT INTO members (officernd_id, name)
           VALUES
           ('member-1', 'Alice Smith'),
           ('member-2', 'Bob Jones'),
           ('member-3', 'Charlie Brown')`,
      );
    });

    it('inserts new members', async () => {
      const membersToInsert = [
        {
          officernd_id: 'member-4',
          name: 'Donald Duck',
          slack_id: 'U123',
          linkedin_url: 'https://linkedin.com/in/johndoe',
          location: OfficeLocation.SAN_FRANCISCO,
        },
        {
          officernd_id: 'member-5',
          name: 'Eve',
          slack_id: 'U456',
          linkedin_url: null,
          location: null,
        },
      ];
      await bulkUpsertMembers(membersToInsert);

      const insertedMembers = await testDbClient.query('SELECT * FROM members');

      expect(insertedMembers?.rows.length).toBe(5);
    });

    it('updates existing member', async () => {
      const memberWithUpdates = {
        officernd_id: 'member-1',
        name: 'Alice Smith',
        slack_id: 'U456',
        linkedin_url: 'https://linkedin.com/in/janesmith',
      };
      await bulkUpsertMembers([memberWithUpdates]);

      const updatedMember = await testDbClient.query('SELECT * FROM members WHERE officernd_id = $1', ['member-1']);

      expect(updatedMember?.rows.length).toBe(1);
      expect(updatedMember?.rows[0]).toMatchObject(memberWithUpdates);
    });
  });

  describe('getLinkedInDocumentsByMemberIdentifier', () => {
    const memberInfo = {
      member_officernd_id: 'member-1',
      member_name: 'Alice Smith',
      member_slack_id: 'U123',
      member_linkedin_url: normalizeLinkedInUrl('https://linkedin.com/in/alice'),
      member_location: 'Seattle',
    };

    beforeEach(async () => {
      // Clear tables
      await testDbClient.query('DELETE FROM rag_docs');
      await testDbClient.query('DELETE FROM members');

      // Insert test member
      await testDbClient.query(
        `INSERT INTO members (officernd_id, name, slack_id, linkedin_url, location)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          memberInfo.member_officernd_id,
          memberInfo.member_name,
          memberInfo.member_slack_id,
          memberInfo.member_linkedin_url,
          memberInfo.member_location,
        ],
      );

      // Insert test LinkedIn documents
      const linkedInDocs = [
        {
          source_type: 'linkedin_experience',
          source_unique_id: 'member-1:linkedin_experience:1',
          content: 'Software Engineer at TechCorp',
          metadata: { officernd_member_id: 'member-1' },
          embedding: generateMockEmbedding(1),
        },
        {
          source_type: 'linkedin_education',
          source_unique_id: 'member-1:linkedin_education:1',
          content: 'Computer Science at University',
          metadata: { officernd_member_id: 'member-1' },
          embedding: generateMockEmbedding(2),
        },
      ];

      for (const doc of linkedInDocs) {
        await insertOrUpdateDoc(doc);
      }
    });

    it('finds documents by member name', async () => {
      const docs = await getLinkedInDocumentsByMemberIdentifier('Alice Smith');
      expect(docs).toHaveLength(2);
      expect(Array.isArray(docs)).toBe(true);
      expect(docs[0]).toMatchObject(memberInfo);
      expect((docs as DocumentWithMemberContext[]).map((d) => d.source_type)).toContain('linkedin_experience');
      expect((docs as DocumentWithMemberContext[]).map((d) => d.source_type)).toContain('linkedin_education');
    });

    it.each([
      ['Slack ID', 'U123'],
      ['LinkedIn URL', 'https://linkedin.com/in/alice'],
      ['LinkedIn URL with different protocol and trailing slash', 'http://linkedin.com/in/alice///'],
      ['OfficeRnD ID', 'member-1'],
    ])('finds documents by %s', async (identifierType, identifier) => {
      const docs = await getLinkedInDocumentsByMemberIdentifier(identifier);
      expect(docs).toHaveLength(2);
      expect(docs[0]).toMatchObject(memberInfo);
    });

    it('returns helpful warning string for non-existent member', async () => {
      const docs = await getLinkedInDocumentsByMemberIdentifier('NonExistentUser');
      expect(docs).toMatch('New profiles are synced daily');
    });
  });
});
