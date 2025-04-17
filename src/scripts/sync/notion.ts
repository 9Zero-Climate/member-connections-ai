import { validateConfig, ConfigContext } from '../../config';
import { updateMembersFromNotion } from '../../services/database';
import { logger } from '../../services/logger';
import { fetchNotionMembers } from '../../services/notion';

/**
 * Sync data from Notion
 * 1. Fetch member data from Notion
 * 2. Update the Members table, and replace all Notion RAG docs for to this member
 */
export async function syncNotion(): Promise<void> {
  logger.info('Starting Notion sync...');
  validateConfig(process.env, ConfigContext.SyncNotion);
  const notionMembers = await fetchNotionMembers();
  await updateMembersFromNotion(notionMembers);
  logger.info('Notion sync complete');
}
