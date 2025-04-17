import { Command } from 'commander';
/**
 * Script to sync data from all external sources:
 *  - OfficeRnd: canonical member data
 *  - LinkedIn: profile data (via proxycurl)
 *  - Notion: 9Zero-specific member metadata
 *  - Slack: conversations
 * We store structured data & embeddings in PostgreSQL
 */
import { createConfig } from '../../config';
import { close as closeDb } from '../../services/database';
import { logger } from '../../services/logger';
import { syncNotion } from './notion';
import { syncLinkedIn } from './linkedin';
import { syncOfficeRnD } from './officernd';

async function syncAll(linkedinMaxUpdates: number, linkedinAllowedAgeDays: number): Promise<void> {
  logger.info('Checking config...');
  createConfig(process.env, 'member-sync');

  logger.info('Starting member synchronization...');
  try {
    const dbMembers = await syncOfficeRnD();
    await syncNotion();
    await syncLinkedIn(dbMembers, linkedinMaxUpdates, linkedinAllowedAgeDays);
  } finally {
    // Close database connection
    await closeDb();
  }
}

// Command-line interface setup
const program = new Command();
program
  .name('sync-all')
  .description('Syncs data from all external sources: OfficeRnD, Notion, LinkedIn')
  .option(
    '--linkedin-max-updates <number>',
    'Maximum number of LinkedIn profiles to update',
    (value) => Number.parseInt(value, 10),
    100, // Default value
  )
  .option(
    '--linkedin-allowed-age-days <number>',
    'Grace period in days before considering a LinkedIn profile out of date',
    (value) => Number.parseInt(value, 10),
    7, // Default value
  )
  .action((options) => {
    syncAll(options.maxUpdates, options.allowedAgeDays);
  });

program.parse(process.argv);

// Export for potential testing or programmatic use
export { syncAll };
