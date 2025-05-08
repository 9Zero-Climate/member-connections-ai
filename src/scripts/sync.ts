import { Command } from 'commander';
import { syncLinkedIn } from '../sync/linkedin';
import { syncNotion } from '../sync/notion';
import { syncOfficeRnD } from '../sync/officernd';
import { syncSlackChannels } from '../sync/slack';

const program = new Command();
program.name('sync').description('CLI tool for syncing data from external sources');

program
  .command('linkedin')
  .description('Syncs data from LinkedIn')
  .option('--max-updates <number>', 'Maximum number of profiles to fetch updates for', Number.parseInt)
  .option('--allowed-age-days <number>', 'Grace period in days to consider a profile out of date', Number.parseInt)
  .action(syncLinkedIn);

program
  //
  .command('notion')
  .description('Syncs data from Notion')
  .action(syncNotion);

program
  //
  .command('officernd')
  .description('Syncs data from OfficeRnD')
  .action(syncOfficeRnD);

program
  .command('slack')
  .description('Sync messages from a specific set of Slack channels')
  .argument('<channelNames...>', 'Names of the channels to sync')
  .option('-l, --limit <number>', 'Maximum number of messages to sync', Number.parseInt)
  .option('-o, --oldest <timestamp>', 'Start time in Unix timestamp')
  .option('-n, --newest <timestamp>', 'End time in Unix timestamp')
  .option('-b, --batch-size <number>', 'Number of messages to process in each batch', Number.parseInt)
  .action(syncSlackChannels);

program.parse();
