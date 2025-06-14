import slackSync from '../../services/slack_sync';

export async function checkSlackConnection(channelName: string) {
  try {
    console.log(`Testing Slack sync for channel: ${channelName}`);

    // Get channel ID
    const channelId = await slackSync.getChannelId(channelName);
    console.log(`Found channel ID: ${channelId}`);

    // Fetch messages
    const yesterdayTimestamp = Date.now() - 24 * 60 * 60 * 1000;
    const messages = await slackSync.fetchChannelHistory(channelId, { latest: yesterdayTimestamp.toString() });
    console.log(`Fetched ${messages.length} messages:`);

    // // Log messages and format one
    // messages.forEach((msg, i) => { // Removed explicit type annotation
    //   console.log(`--- Message ${i + 1} ---`);
    //   console.log(`TS: ${msg.ts}`);
    //   console.log(`User: ${msg.user}`);
    //   console.log(`Text: ${msg.text?.substring(0, 50)}...`);
    // });

    if (messages.length > 0) {
      console.log('Example raw message:', messages[0]);
      const formatted = await slackSync.processMessages(messages, channelId);
      console.log('Formatted message:', formatted[0]);
    } else {
      console.log('No messages found to format.');
    }
  } catch (error) {
    console.error('Error testing Slack sync:', error);
  }
}
