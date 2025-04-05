import type { Document } from './database';
import { doesSlackMessageMatchDb } from './slack_sync';

describe('areSlackMessagesEqual', () => {
  const baseDoc: Document = {
    source_type: 'slack',
    source_unique_id: 'test:123',
    content: 'Hello world',
    embedding: null,
    metadata: {
      slack_user_id: 'U123',
      channel: 'C123',
      channel_name: 'general',
    },
  };

  it('should return true for identical documents', () => {
    const doc1 = { ...baseDoc };
    const doc2 = { ...baseDoc };
    expect(doesSlackMessageMatchDb(doc1, doc2)).toBe(true);
  });

  it('should return false for different content', () => {
    const doc1 = { ...baseDoc };
    const doc2 = { ...baseDoc, content: 'Different content' };
    expect(doesSlackMessageMatchDb(doc1, doc2)).toBe(false);
  });

  it('should ignore undefined/null metadata fields', () => {
    const doc1 = {
      ...baseDoc,
      metadata: {
        ...baseDoc.metadata,
        thread_ts: undefined,
        reply_count: undefined,
      },
    };
    const doc2 = {
      ...baseDoc,
      metadata: {
        ...baseDoc.metadata,
        // These fields are missing entirely
      },
    };
    expect(doesSlackMessageMatchDb(doc1, doc2)).toBe(true);
  });

  it('should handle missing metadata', () => {
    const doc1 = { ...baseDoc, metadata: undefined };
    const doc2 = { ...baseDoc, metadata: {} };
    expect(doesSlackMessageMatchDb(doc1, doc2)).toBe(true);
  });

  it('should ignore database-specific fields', () => {
    const doc1 = {
      ...baseDoc,
      created_at: new Date('2024-03-14'),
      updated_at: new Date('2024-03-14'),
    };
    const doc2 = { ...baseDoc };
    expect(doesSlackMessageMatchDb(doc1, doc2)).toBe(true);
  });

  it('should ignore embedding differences', () => {
    const doc1 = { ...baseDoc, embedding: [1, 2, 3] };
    const doc2 = { ...baseDoc, embedding: [4, 5, 6] };
    expect(doesSlackMessageMatchDb(doc1, doc2)).toBe(true);
  });

  it('should detect meaningful metadata differences', () => {
    const doc1 = {
      ...baseDoc,
      metadata: {
        ...baseDoc.metadata,
        reactions: [{ name: 'thumbsup', count: 1 }],
      },
    };
    const doc2 = {
      ...baseDoc,
      metadata: {
        ...baseDoc.metadata,
        reactions: [{ name: 'thumbsdown', count: 1 }],
      },
    };
    expect(doesSlackMessageMatchDb(doc1, doc2)).toBe(false);
  });
});
