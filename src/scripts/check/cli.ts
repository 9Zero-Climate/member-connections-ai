import { Command } from 'commander';
import { checkOfficeRnDConnection } from './officernd';
import { checkSlackConnection } from './slack';

const program = new Command();
program.name('check').description('CLI tool for checking the connection to external sources');

program
  //
  .command('officernd')
  .description('Checks OfficeRnD connection')
  .action(checkOfficeRnDConnection);

program
  //
  .command('slack')
  .description('Check Slack connection')
  .argument('<channelName>', 'Name of the channel to query')
  .action(checkSlackConnection);

program.parse();
