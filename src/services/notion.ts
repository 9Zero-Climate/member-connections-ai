import { Client } from '@notionhq/client';
import type {
  MultiSelectPropertyItemObjectResponse,
  PageObjectResponse,
  QueryDatabaseParameters,
  QueryDatabaseResponse,
  RichTextItemResponse,
} from '@notionhq/client/build/src/api-endpoints';
import { config } from '../config';
import { logger } from './logger';

// Initialize Notion Client but allow injection for testing
let notionClient: Client;
let databaseId: string | null = null;

export function initNotionClient(client?: Client) {
  notionClient = client || new Client({ auth: config.notionApiKey });
  databaseId = config.notionMembersDbId || null;

  if (!databaseId) {
    logger.error('NOTION_MEMBERS_DATABASE_ID is not configured.');
  }

  return notionClient;
}

// Initialize with default client if not in test environment
if (process.env.NODE_ENV !== 'test') {
  initNotionClient();
}

export interface NotionMemberData {
  notionPageId: string;
  notionPageUrl: string;
  name: string | null;
  linkedinUrl: string | null;
  locationTags: string[];
  expertiseTags: string[];
  hiring: boolean;
  lookingForWork: boolean;
  // Add other relevant fields as needed
}

// Helper function to extract plain text from Notion's rich text array
function getPlainTextFromRichText(richText: Array<RichTextItemResponse>): string {
  return richText.map((t) => t.plain_text).join('');
}

// Helper function to safely parse page properties
function parseMemberProperties(page: PageObjectResponse): NotionMemberData | null {
  // Property names must match exactly those in your Notion DB
  const props = page.properties;

  // Using type assertion for property access is common with Notion API
  // as property names are dynamic strings.
  const nameProp = props.Name;
  const name = nameProp?.type === 'title' ? getPlainTextFromRichText(nameProp.title) : null;

  // Skip pages without a name
  if (!name) {
    logger.warn(`Skipping Notion page ${page.id} due to missing Name property.`);
    return null;
  }

  const linkedInProp = props.LinkedIn;
  const linkedinUrl = linkedInProp?.type === 'url' ? linkedInProp.url : null;

  const locationProp = props.Location;
  const locationTags =
    locationProp?.type === 'multi_select'
      ? locationProp.multi_select.map((tag: MultiSelectPropertyItemObjectResponse['multi_select'][number]) => tag.name)
      : [];

  const sectorsProp = props.Sectors;
  const sectorTags =
    sectorsProp?.type === 'multi_select'
      ? sectorsProp.multi_select.map((tag: MultiSelectPropertyItemObjectResponse['multi_select'][number]) => tag.name)
      : [];

  const subSectorProp = props['Sub-Sector']; // Keep brackets for names with special chars
  const subSectorText = subSectorProp?.type === 'rich_text' ? getPlainTextFromRichText(subSectorProp.rich_text) : '';
  const subSectorTags = subSectorText ? [subSectorText] : []; // Treat rich text as a single tag

  const hobbiesProp = props['Hobbies/Interests']; // Keep brackets
  const hobbyTags =
    hobbiesProp?.type === 'multi_select'
      ? hobbiesProp.multi_select.map((tag: MultiSelectPropertyItemObjectResponse['multi_select'][number]) => tag.name)
      : [];

  const roleCurrentProp = props['Role (Current or Experienced)']; // Keep brackets
  const roleCurrentTags =
    roleCurrentProp?.type === 'multi_select'
      ? roleCurrentProp.multi_select.map(
          (tag: MultiSelectPropertyItemObjectResponse['multi_select'][number]) => tag.name,
        )
      : [];

  const roleInterestedProp = props['Role (Interested)']; // Keep brackets
  const roleInterestedTags =
    roleInterestedProp?.type === 'multi_select'
      ? roleInterestedProp.multi_select.map(
          (tag: MultiSelectPropertyItemObjectResponse['multi_select'][number]) => tag.name,
        )
      : [];

  const expertiseTags = [
    ...sectorTags,
    ...subSectorTags,
    ...hobbyTags,
    ...roleCurrentTags,
    ...roleInterestedTags,
  ].filter(Boolean); // Combine and remove empty strings

  const hiringProp = props['Hiring?']; // Keep brackets
  const hiring = hiringProp?.type === 'checkbox' ? hiringProp.checkbox : false;

  const lookingProp = props['Open for work?']; // Keep brackets
  const lookingForWork = lookingProp?.type === 'checkbox' ? lookingProp.checkbox : false;

  return {
    notionPageId: page.id,
    notionPageUrl: page.public_url || '',
    name,
    linkedinUrl,
    locationTags,
    expertiseTags,
    hiring,
    lookingForWork,
  };
}

/**
 * Fetches all members (pages) from the configured Notion database.
 * Handles pagination automatically.
 * @returns Array of parsed Notion member data.
 */
export async function fetchNotionMembers(): Promise<NotionMemberData[]> {
  if (!databaseId) {
    logger.error('Cannot fetch Notion members: Database ID not configured.');
    return [];
  }

  if (!notionClient) {
    logger.error('Notion client not initialized.');
    return [];
  }

  const allMembers: NotionMemberData[] = [];
  let hasMore = true;
  let startCursor: string | undefined = undefined;

  logger.info(`Fetching members from Notion database: ${databaseId}`);

  while (hasMore) {
    const queryOptions: QueryDatabaseParameters = {
      database_id: databaseId,
      page_size: 100, // Notion API max page size
    };
    if (startCursor) {
      queryOptions.start_cursor = startCursor;
    }

    const response: QueryDatabaseResponse = await notionClient.databases.query(queryOptions);

    for (const page of response.results) {
      // Type guard to ensure we have a full PageObjectResponse
      if (page.object === 'page' && 'properties' in page) {
        const parsedData = parseMemberProperties(page);
        if (parsedData) {
          allMembers.push(parsedData);
        }
      } else {
        // Handle partial page object responses if necessary, though less common in db queries
        logger.warn(`Received partial page object response: ${page.id}`);
      }
    }

    hasMore = response.has_more;
    startCursor = response.next_cursor ?? undefined;
  }
  logger.info(`Successfully fetched ${allMembers.length} members from Notion.`);

  return allMembers;
}
