import { Command } from 'commander';
import { ConfigContext, validateConfig } from '../../config';
import { type Member, bulkUpsertMembers } from '../../services/database';
import { logger } from '../../services/logger';
import { getAllMembers } from '../../services/officernd';

/**
 * Sync data from OfficeRnD
 * 1. Fetch member data from OfficeRnD
 * 2. Insert into Members table
 * @returns The inserted/updated members
 */
export async function syncOfficeRnD(): Promise<void> {
  logger.info('Starting OfficeRnD sync...');

  validateConfig(process.env, ConfigContext.SyncOfficeRnD);
  const officeRndMembers = await getAllMembers();
  await bulkUpsertMembers(officeRndMembers);

  logger.info('OfficeRnD sync complete');
}

const program = new Command();
program
  //
  .name('sync-officernd')
  .description('Syncs data from OfficeRnD')
  .action(syncOfficeRnD);

program.parse();
