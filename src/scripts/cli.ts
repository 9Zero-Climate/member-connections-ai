import { Command } from 'commander';
import { syncLinkedIn } from './sync/linkedin';
import { syncNotion } from './sync/notion';
import { syncOfficeRnD } from './sync/officernd';
import { syncSlackChannels } from './sync/slack';
import { migrate } from './migrate';

const program = new Command();
program.name('member-connections-ai').description('CLI tool for member connections AI');

program
  .command('sync-linkedin')
  .description('Syncs data from LinkedIn')
  .option('--max-updates <number>', 'Maximum number of profiles to fetch updates for', Number.parseInt)
  .option('--allowed-age-days <number>', 'Grace period in days to consider a profile out of date', Number.parseInt)
  .action(syncLinkedIn);

program
  //
  .command('sync-notion')
  .description('Syncs data from Notion')
  .action(syncNotion);

program
  //
  .command('sync-officernd')
  .description('Syncs data from OfficeRnD')
  .action(syncOfficeRnD);

program
  .command('sync-slack-channels')
  .description('Sync messages from a specific set of Slack channels')
  .argument('<channelNames...>', 'Names of the channels to sync')
  .option('-l, --limit <number>', 'Maximum number of messages to sync', Number.parseInt)
  .option('-o, --oldest <timestamp>', 'Start time in Unix timestamp')
  .option('-n, --newest <timestamp>', 'End time in Unix timestamp')
  .option('-b, --batch-size <number>', 'Number of messages to process in each batch', Number.parseInt)
  .action(syncSlackChannels);

program
  .command('migrate')
  .description('Run a single SQL migration file')
  .argument('<filePath>', 'Path to the SQL migration file')
  .action(migrate);

program.parse();
