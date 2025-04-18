import { Command } from 'commander';
/**
 * Script to sync data from all external sources:
 *  - OfficeRnd: canonical member data
 *  - LinkedIn: profile data (via proxycurl)
 *  - Notion: 9Zero-specific member metadata
 *  - Slack: conversations
 * We store structured data & embeddings in PostgreSQL
 */
import { ConfigContext, validateConfig } from '../../config';
import { closeDbConnection } from '../../services/database';
import { logger } from '../../services/logger';
import { syncLinkedIn } from './linkedin';
import { syncNotion } from './notion';
import { syncOfficeRnD } from './officernd';

async function syncAll(linkedinMaxUpdates: number, linkedinAllowedAgeDays: number): Promise<void> {
  validateConfig(process.env, ConfigContext.SyncAll);

  logger.info('Starting member synchronization...');
  try {
    await syncOfficeRnD();
    await syncNotion();
    await syncLinkedIn({ maxUpdates: linkedinMaxUpdates, allowedAgeDays: linkedinAllowedAgeDays });
  } finally {
    await closeDbConnection();
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
    syncAll(options.linkedinMaxUpdates, options.linkedinAllowedAgeDays);
  });

program.parse();

// Export for potential testing or programmatic use
export { syncAll };
