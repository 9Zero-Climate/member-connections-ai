import { closeDbConnection, deleteDoc, findSimilar, getDocBySource, insertOrUpdateDoc } from '../services/database';

interface TestDoc {
  source_type: string;
  source_unique_id: string;
  content: string;
  embedding: number[];
  metadata: {
    user: string;
    channel: string;
    thread_ts: string;
    reply_count: number;
    reactions: Array<{ name: string; count: number }>;
    permalink: string;
    slack_user_id?: string;
  };
}

async function testDatabase(): Promise<void> {
  try {
    console.log('Testing database connection and operations...\n');

    // Test document with properly formatted vector
    const testDoc: TestDoc = {
      source_type: 'test',
      source_unique_id: `test_${Date.now()}`,
      content: 'This is a test document',
      embedding: [0.1, 0.2, 0.3, 0.4, 0.5],
      metadata: {
        user: 'U1234567890',
        channel: 'C1234567890',
        thread_ts: '1234567890.123456',
        reply_count: 2,
        reactions: [{ name: 'thumbsup', count: 1 }],
        permalink: 'https://slack.com/archives/C1234567890/p1234567890123456',
      },
    };

    // Test insert
    console.log('Testing insert...');
    const inserted = await insertOrUpdateDoc(testDoc);
    console.log('Inserted document:', inserted);

    // Test get by source
    console.log('\nTesting get by source...');
    const retrieved = await getDocBySource(testDoc.source_unique_id);
    console.log('Retrieved document:', retrieved);

    // Test update
    console.log('\nTesting update...');
    const updated = await insertOrUpdateDoc({
      ...testDoc,
      content: 'Updated test content',
      embedding: [0.6, 0.7, 0.8, 0.9, 1.0],
    });
    console.log('Updated document:', updated);

    // Test similarity search
    console.log('\nTesting similarity search...');
    const similar = await findSimilar([0.1, 0.2, 0.3, 0.4, 0.5], { limit: 1 });
    console.log(
      'Similar documents:',
      similar.map((doc) => ({
        ...doc,
        metadata: {
          ...doc.metadata,
          slack_user_id: doc.metadata?.slack_user_id || null,
        },
      })),
    );

    // Test delete
    console.log('\nTesting delete...');
    const deleted = await deleteDoc(testDoc.source_unique_id);
    console.log('Delete successful:', deleted);

    // Verify deletion
    const afterDelete = await getDocBySource(testDoc.source_unique_id);
    console.log('\nDocument after deletion:', afterDelete);

    console.log('\nAll tests completed successfully!');
  } catch (error) {
    console.error('Error during testing:', error);
  } finally {
    await closeDbConnection();
  }
}

// Run the tests
testDatabase();
