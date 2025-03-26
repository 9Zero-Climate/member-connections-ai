const { Command } = require('commander');
const slackSync = require('./services/slack_sync');
const { insertDoc } = require('./services/database');

const program = new Command();

program
    .name('slack-sync')
    .description('CLI tool for syncing Slack channel content to the database');

program
    .command('sync-channel')
    .description('Sync messages from a specific Slack channel')
    .argument('<channelName>', 'Name of the channel to sync')
    .option('-l, --limit <number>', 'Maximum number of messages to sync', '100')
    .option('-o, --oldest <timestamp>', 'Start time in Unix timestamp')
    .option('-n, --newest <timestamp>', 'End time in Unix timestamp')
    .action(async (channelName, options) => {
        try {
            console.log(`Syncing channel: ${channelName}`);

            // Get channel ID
            const channelId = await slackSync.getChannelId(channelName);
            console.log(`Found channel ID: ${channelId}`);

            // Fetch messages
            const messages = await slackSync.fetchChannelHistory(channelId, {
                limit: parseInt(options.limit),
                oldest: options.oldest,
                latest: options.newest,
            });
            console.log(`Fetched ${messages.length} messages`);

            // Format and store messages
            const formattedMessages = messages.map(msg => slackSync.formatMessage(msg, channelId));
            for (const msg of formattedMessages) {
                await insertDoc(msg);
            }
            console.log(`Successfully synced ${formattedMessages.length} messages to database`);
        } catch (error) {
            console.error('Error syncing channel:', error);
            process.exit(1);
        }
    });

program.parse(); 