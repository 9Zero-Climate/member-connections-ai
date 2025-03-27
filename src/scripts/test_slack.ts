import slackSync from '../services/slack_sync';

interface SlackMessage {
  ts: string;
  text: string;
  user: string;
  thread_ts?: string;
  reactions?: Array<{ name: string; count: number }>;
}

interface FormattedMessage {
  source_type: string;
  source_unique_id: string;
  content: string;
  metadata: {
    user: string;
    channel: string;
    thread_ts?: string;
    reply_count?: number;
    reactions?: Array<{ name: string; count: number }>;
    permalink?: string;
  };
}

async function testSlackSync(): Promise<void> {
  try {
    console.log('Testing Slack sync service...\n');

    // Test channel ID lookup
    console.log('Looking up channel ID...');
    const channelId = await slackSync.getChannelId('introductions');
    console.log('Found channel ID:', channelId);

    // Test message fetching
    console.log('\nFetching messages...');
    const messages = await slackSync.fetchChannelHistory(channelId, { limit: 5 });
    console.log(`Found ${messages.length} messages`);

    // Display messages
    console.log('\nMessages:');
    messages.forEach((msg: SlackMessage, i: number) => {
      console.log(`\nMessage ${i + 1}:`);
      console.log('Timestamp:', msg.ts);
      console.log('Text:', msg.text);
      console.log('User:', msg.user);
      if (msg.thread_ts) {
        console.log('Thread:', msg.thread_ts);
      }
      if (msg.reactions) {
        console.log('Reactions:', msg.reactions.map((r) => `${r.name}: ${r.count}`).join(', '));
      }
    });

    // Test message formatting
    console.log('\nTesting message formatting...');
    const formatted = slackSync.formatMessage(messages[0], channelId);
    console.log('Formatted message:', JSON.stringify(formatted, null, 2));

    console.log('\nAll tests completed successfully!');
  } catch (error) {
    console.error('Error during testing:', error);
  }
}

// Run the tests
testSlackSync();
