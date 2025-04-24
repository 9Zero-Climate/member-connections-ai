import { Command } from 'commander';
import { migrate, migrateAll } from './index';

const program = new Command();
program.name('migrate').description('CLI tool for running migrations');

program
  .command('file')
  .description('Run a single SQL migration file')
  .argument('<filePath>', 'Path to the SQL migration file')
  .action(migrate);

program
  //
  .command('all')
  .description('Run all migration files')
  .argument('[connectionString]', '(optional) db connection string. Defaults to DB_URL environment variable')
  .action(migrateAll);

program.parse();
