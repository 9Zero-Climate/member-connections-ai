import { Command } from 'commander';
import { syncLinkedIn } from '../sync/linkedin';
import { syncNotion } from '../sync/notion';
import { syncOfficeRnD } from '../sync/officernd';
import { importSlackHistory, syncSlackChannels } from '../sync/slack';

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
  .option('--oldest <timestamp>', 'Start time in Unix timestamp')
  .option('--latest <timestamp>', 'End time in Unix timestamp')
  .action(syncSlackChannels);

program
  .command('slack-history')
  .description(
    'Import Slack history from an exported .zip file. \
    See https://slack.com/help/articles/201658943-Export-your-workspace-data for how to export.',
  )
  .argument('<folderPath>', 'Path to the folder containing the (unzipped) export')
  .argument('<channelNames...>', 'Names of the channels to sync')
  .action(importSlackHistory);

program.parse();
