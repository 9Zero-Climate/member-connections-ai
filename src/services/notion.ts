import { Client } from '@notionhq/client';
import type {
  MultiSelectPropertyItemObjectResponse,
  PageObjectResponse,
  QueryDatabaseParameters,
  QueryDatabaseResponse,
  RichTextItemResponse,
} from '@notionhq/client/build/src/api-endpoints';
import { z } from 'zod';
import { config } from '../config';
import { logger } from './logger';
import { TitleProperty, UrlProperty, MultiSelectProperty, RichTextProperty, CheckboxProperty } from './notionSchema';

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

const MemberPagePropertiesSchema = z.object({
  Name: TitleProperty,
  LinkedIn: UrlProperty,
  Location: MultiSelectProperty,
  Sectors: MultiSelectProperty,
  'Sub-Sector': RichTextProperty,
  'Hobbies/Interests': MultiSelectProperty,
  'Role (Current or Experienced)': MultiSelectProperty,
  'Role (Interested)': MultiSelectProperty,
  'Hiring?': CheckboxProperty,
  'Open for work?': CheckboxProperty,
});
type MemberProperties = z.infer<typeof MemberPagePropertiesSchema>;

export interface NotionMemberData {
  notionPageId: string;
  notionPageUrl: string;
  name: string | null;
  linkedinUrl: string | null;
  locationTags: string[];
  expertiseTags: string[];
  hiring: boolean;
  lookingForWork: boolean;
}

const getTagName = (tag: MultiSelectPropertyItemObjectResponse['multi_select'][number]) => tag.name;

const getPlainTextFromRichText = (richTextItems: Array<RichTextItemResponse>): string => {
  return richTextItems.map((richTextItem) => richTextItem.plain_text).join(' ');
};

const isValidMemberProperties = (properties: PageObjectResponse['properties']): properties is MemberProperties => {
  MemberPagePropertiesSchema.parse(properties);

  // zod parse throws an error on invalid schema, so if we get here, the schema is valid
  return true;
};

// Helper function to safely parse page properties
export const parseMemberPage = (page: PageObjectResponse): NotionMemberData | null => {
  const memberProperties = page.properties;

  // Validate properties against expected schema
  // The validation throws an error when invalid, so the return statement is never executed,
  // but having the validation check in a conditional branch is required to make the TypeScript
  // narrowing on the 'is' keyword funciton properly
  if (!isValidMemberProperties(memberProperties)) {
    return null;
  }

  const name = getPlainTextFromRichText(memberProperties.Name.title);

  if (!name) {
    logger.warn(`Skipping Notion page ${page.id} due to missing Name property.`);
    return null;
  }

  const linkedinUrl = memberProperties.LinkedIn.url;
  const locationTags = memberProperties.Location.multi_select.map(getTagName);
  const sectorTags = memberProperties.Sectors.multi_select.map(getTagName);
  const subSectorTags = [getPlainTextFromRichText(memberProperties['Sub-Sector'].rich_text)]; // Treat rich text as a single tag
  const hobbyTags = memberProperties['Hobbies/Interests'].multi_select.map(getTagName);
  const roleCurrentTags = memberProperties['Role (Current or Experienced)'].multi_select.map(getTagName);
  const roleInterestedTags = memberProperties['Role (Interested)'].multi_select.map(getTagName);

  const expertiseTags = [
    ...sectorTags,
    ...subSectorTags,
    ...hobbyTags,
    ...roleCurrentTags,
    ...roleInterestedTags,
  ].filter(Boolean);

  const hiring = memberProperties['Hiring?'].checkbox;
  const lookingForWork = memberProperties['Open for work?'].checkbox;

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
};

/**
 * Fetches all members (pages) from the configured Notion database.
 * Handles pagination automatically.
 * @returns Array of parsed Notion member data.
 */
export const fetchNotionMembers = async (): Promise<NotionMemberData[]> => {
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
        const parsedData = parseMemberPage(page);
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
};
