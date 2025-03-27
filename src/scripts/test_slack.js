const slackSync = require('../services/slack_sync');

async function testSlackSync() {
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
    messages.forEach((msg, i) => {
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
