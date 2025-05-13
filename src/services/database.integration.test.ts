import type { Client } from 'pg';
import { mockEmbeddingsService } from './mocks';

import type { DocumentWithMemberContext } from './database';
import {
  OfficeLocation,
  bulkUpsertMembers,
  deleteDoc,
  deleteLinkedinDocumentsForOfficerndId,
  deleteMember,
  findSimilar,
  getDocBySource,
  getLinkedInDocumentsByMemberIdentifier,
  getMembersWithLastLinkedInUpdates,
  getOnboardingConfig,
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
        location: null,
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
      const nonExistentMemberId = 'non-existent-member';
      await expect(getLinkedInDocumentsByMemberIdentifier(nonExistentMemberId)).rejects.toThrow(
        /No synced LinkedIn profile found for the given identifier./,
      );
    });
  });

  describe('getOnboardingConfig', () => {
    it('returns onboarding config for a location', async () => {
      const location = OfficeLocation.SEATTLE;
      const config = await getOnboardingConfig(location);

      expect(config).toEqual({
        admin_user_slack_ids: ['U073CUASRSR', 'U07QU1QCX52'],
        onboarding_message_content: expect.stringContaining('Join #introductions'),
      });
    });

    it('throws error for non-existent location', async () => {
      const nonExistentLocation = 'NonExistentLocation' as OfficeLocation;
      await expect(getOnboardingConfig(nonExistentLocation)).rejects.toThrow(
        'No onboarding config found for location: NonExistentLocation',
      );
    });
  });

  describe('deleteMember', () => {
    beforeEach(async () => {
      // Clear members table and insert a test member
      await testDbClient.query('DELETE FROM members CASCADE');
      await testDbClient.query(
        `INSERT INTO members (officernd_id, name, location)
           VALUES
           ('test-delete-id', 'Test Delete User', 'Seattle')`,
      );
    });

    it('deletes an existing member', async () => {
      await deleteMember('test-delete-id');
      const result = await testDbClient.query("SELECT * FROM members WHERE officernd_id = 'test-delete-id'");
      expect(result.rowCount).toBe(0);
    });
  });
});

describe('getMembersWithLastLinkedInUpdates', () => {
  let testDbClient: Client;

  const seattleMemberLastLinkedInUpdate = new Date(2021, 1, 1);
  const sfMemberLastLinkedInUpdate = new Date(2022, 2, 2);

  const seattleMember = {
    officernd_id: 'seattle-member',
    name: 'Seattle Member',
    linkedin_url: 'https://linkedin.com/in/seattle-member',
    location: OfficeLocation.SEATTLE,
    created_at: new Date(),
    updated_at: new Date(),
  };
  const sfMember = {
    officernd_id: 'sf-member',
    name: 'SF Member',
    linkedin_url: 'https://linkedin.com/in/sf-member',
    location: OfficeLocation.SAN_FRANCISCO,
    created_at: new Date(),
    updated_at: new Date(),
  };
  const sfMemberWithoutLinkedinOrRAGDocs = {
    officernd_id: 'sf-member-without-linkedin',
    name: 'SF Member without LinkedIn',
    linkedin_url: null,
    location: OfficeLocation.SAN_FRANCISCO,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const seattleMemberDoc = {
    source_type: 'linkedin_profile',
    source_unique_id: `officernd_member_${seattleMember.officernd_id}:profile`,
    content: 'Profile for Seattle Member',
    embedding: generateMockEmbedding(1),
    created_at: seattleMemberLastLinkedInUpdate,
    updated_at: seattleMemberLastLinkedInUpdate,
  };
  const sfMemberDoc = {
    source_type: 'linkedin_posts',
    source_unique_id: `officernd_member_${sfMember.officernd_id}:posts`,
    content: 'Posts for SF Member',
    embedding: generateMockEmbedding(2),
    created_at: sfMemberLastLinkedInUpdate,
    updated_at: sfMemberLastLinkedInUpdate,
  };

  beforeAll(async () => {
    testDbClient = await getOrCreateClient();
    await testDbClient.query('DELETE FROM members CASCADE');
    await testDbClient.query('DELETE FROM rag_docs');

    // Insert members
    const memberValues = [seattleMember, sfMemberWithoutLinkedinOrRAGDocs, sfMember]
      .map(
        (m) =>
          `('${m.officernd_id}', '${m.name}', ${m.linkedin_url ? `'${m.linkedin_url}'` : 'NULL'}, '${m.location}', '${m.created_at.toISOString()}', '${m.updated_at.toISOString()}')`,
      )
      .join(',');
    await testDbClient.query(
      `INSERT INTO members (officernd_id, name, linkedin_url, location, created_at, updated_at) VALUES ${memberValues}`,
    );

    // Insert related docs
    const relatedDocValues = [seattleMemberDoc, sfMemberDoc]
      .map(
        (d) =>
          `('${d.source_type}', '${d.source_unique_id}', '${d.content}', '${d.created_at.toISOString()}', '${d.updated_at.toISOString()}')`,
      )
      .join(',');
    await testDbClient.query(
      `INSERT INTO rag_docs (source_type, source_unique_id, content, created_at, updated_at) VALUES ${relatedDocValues}`,
    );
  });

  it('fetches all members with their correct last LinkedIn update times', async () => {
    const results = await getMembersWithLastLinkedInUpdates();

    expect(results).toHaveLength(3);

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: seattleMember.officernd_id,
          last_linkedin_update: seattleMemberLastLinkedInUpdate,
        }),
        expect.objectContaining({
          id: sfMemberWithoutLinkedinOrRAGDocs.officernd_id,
          last_linkedin_update: null,
        }),
        expect.objectContaining({
          id: sfMember.officernd_id,
          last_linkedin_update: sfMemberLastLinkedInUpdate,
        }),
      ]),
    );
  });

  it('fetches a specific member with their last LinkedIn update time when officerndId is provided', async () => {
    const results = await getMembersWithLastLinkedInUpdates(seattleMember.officernd_id);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: seattleMember.officernd_id,
      last_linkedin_update: seattleMemberLastLinkedInUpdate,
    });
  });

  it('fetches a specific member with null update time if no docs exist', async () => {
    const results = await getMembersWithLastLinkedInUpdates(sfMemberWithoutLinkedinOrRAGDocs.officernd_id);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: sfMemberWithoutLinkedinOrRAGDocs.officernd_id,
      last_linkedin_update: null,
    });
  });

  it('returns an empty array if the specified officerndId does not exist', async () => {
    const results = await getMembersWithLastLinkedInUpdates('non-existent-member');
    expect(results).toHaveLength(0);
  });
});

describe('deleteLinkedinDocumentsForOfficerndId', () => {
  let testDbClient: Client;
  const memberId1 = 'linkedin-doc-member-1';
  const memberId2 = 'linkedin-doc-member-2'; // Member with no LinkedIn docs initially

  const doc1Profile = {
    source_type: 'linkedin_profile',
    source_unique_id: `officernd_member_${memberId1}:profile`,
    content: 'Profile info for member 1',
    embedding: generateMockEmbedding(10),
    created_at: new Date(),
  };
  const doc1Posts = {
    source_type: 'linkedin_posts',
    source_unique_id: `officernd_member_${memberId1}:post_xyz`,
    content: 'Post by member 1',
    embedding: generateMockEmbedding(11),
    created_at: new Date(),
  };
  const docOtherMember = {
    source_type: 'linkedin_profile',
    source_unique_id: 'officernd_member_other-member-id:profile',
    content: 'Profile for another member',
    embedding: generateMockEmbedding(12),
    created_at: new Date(),
  };
  const docNotLinkedin = {
    source_type: 'slack',
    source_unique_id: `slack_${memberId1}_123`,
    content: 'Slack message by member 1',
    embedding: generateMockEmbedding(13),
    created_at: new Date(),
  };
  const ragDocsToInsert = [doc1Profile, doc1Posts, docOtherMember, docNotLinkedin];

  beforeAll(async () => {
    testDbClient = await getOrCreateClient();
  });

  beforeEach(async () => {
    await testDbClient.query('DELETE FROM rag_docs');
    for (const doc of ragDocsToInsert) {
      await testDbClient.query(
        'INSERT INTO rag_docs (source_type, source_unique_id, content, created_at) VALUES ($1, $2, $3, $4)',
        [doc.source_type, doc.source_unique_id, doc.content, doc.created_at],
      );
    }
  });

  it('deletes only LinkedIn documents for the specified member ID', async () => {
    await deleteLinkedinDocumentsForOfficerndId(memberId1);

    // Check that member1's LinkedIn docs are gone
    const member1Docs = await testDbClient.query(
      `SELECT * FROM rag_docs WHERE source_unique_id LIKE 'officernd_member_${memberId1}:%' AND source_type LIKE 'linkedin_%'`,
    );
    expect(member1Docs.rowCount).toBe(0);

    // Check that member1's non-LinkedIn docs are still there
    const member1NonLinkedinDocs = await testDbClient.query(
      `SELECT * FROM rag_docs WHERE source_unique_id LIKE 'slack_${memberId1}%'`,
    );
    expect(member1NonLinkedinDocs.rowCount).toBe(1);
    expect(member1NonLinkedinDocs.rows[0].source_unique_id).toBe(docNotLinkedin.source_unique_id);

    // Check that other member's LinkedIn docs are still there
    const otherMemberDocs = await testDbClient.query('SELECT * FROM rag_docs WHERE source_unique_id = $1', [
      docOtherMember.source_unique_id,
    ]);
    expect(otherMemberDocs.rowCount).toBe(1);
    expect(otherMemberDocs.rows[0].source_unique_id).toBe(docOtherMember.source_unique_id);
  });

  it('does not throw an error if no LinkedIn documents exist for the member', async () => {
    await expect(deleteLinkedinDocumentsForOfficerndId(memberId2)).resolves.not.toThrow();

    // Verify no docs were deleted (as none matched)
    const allDocs = await testDbClient.query('SELECT * FROM rag_docs');
    expect(allDocs.rowCount).toBe(4); // Initially inserted 4 docs
  });
});
