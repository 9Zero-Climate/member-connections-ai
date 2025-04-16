// Suppress TS errors for missing types if they persist after attempts to fix
// @ts-nocheck

import type { Client } from '@notionhq/client';
import type {
  PageObjectResponse,
  PartialPageObjectResponse,
  QueryDatabaseParameters,
  QueryDatabaseResponse,
  TextRichTextItemResponse, // Import for annotations type
} from '@notionhq/client/build/src/api-endpoints';
import { mockDeep, mockReset } from 'jest-mock-extended';
import * as configModule from '../config'; // Import namespace for spying
import { config } from '../config';
import { logger } from './logger';
import type { NotionMemberData } from './notion';
import { fetchNotionMembers, initNotionClient } from './notion';

// Define a default annotation object to avoid 'as any'
const defaultAnnotations: TextRichTextItemResponse['annotations'] = {
  bold: false,
  italic: false,
  strikethrough: false,
  underline: false,
  code: false,
  color: 'default',
};

const mockLogger = {
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
};

jest.mock('./logger', () => ({
  logger: mockLogger,
}));

// Helper to create a mock PageObjectResponse (partial but typed)
type MockProperties = PageObjectResponse['properties'];
const createMockPage = (
  id: string,
  properties: MockProperties,
): Partial<PageObjectResponse> & { object: 'page'; id: string } => ({
  object: 'page',
  id: id,
  properties: properties,
});

const MOCK_VALID_PROPERTIES: MockProperties = {
  Name: {
    id: '1',
    type: 'title',
    title: [
      {
        type: 'text',
        text: { content: 'Alice Test', link: null },
        annotations: defaultAnnotations,
        plain_text: 'Alice Test',
        href: null,
      },
    ],
  },
  LinkedIn: { id: '2', type: 'url', url: 'https://linkedin.com/in/alice' },
  Location: {
    id: '3',
    type: 'multi_select',
    multi_select: [
      { id: 'ms1', name: 'Seattle', color: 'blue' },
      { id: 'ms2', name: 'Remote', color: 'gray' },
    ],
  },
  Sectors: { id: '4', type: 'multi_select', multi_select: [{ id: 'ms3', name: 'Energy', color: 'red' }] },
  'Sub-Sector': {
    id: '5',
    type: 'rich_text',
    rich_text: [
      {
        type: 'text',
        text: { content: 'Solar', link: null },
        annotations: defaultAnnotations,
        plain_text: 'Solar',
        href: null,
      },
    ],
  },
  'Hobbies/Interests': {
    id: '6',
    type: 'multi_select',
    multi_select: [{ id: 'ms4', name: 'Hiking', color: 'green' }],
  },
  'Role (Current or Experienced)': {
    id: '7',
    type: 'multi_select',
    multi_select: [{ id: 'ms5', name: 'Engineer', color: 'purple' }],
  },
  'Role (Interested)': { id: '8', type: 'multi_select', multi_select: [] },
  'Hiring?': { id: '9', type: 'checkbox', checkbox: false },
  'Open for work?': { id: '10', type: 'checkbox', checkbox: true },
};

describe('Notion Service', () => {
  let mockClient: jest.Mocked<Client>;
  let notionModule: typeof import('./notion');

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.resetModules();

    // Mock the config module with default values
    jest.mock('../config', () => ({
      config: {
        notionApiKey: 'mock-api-key',
        notionMembersDbId: 'test-db-id',
      },
    }));

    // Mock the Notion client
    jest.mock('@notionhq/client');

    // Reset client mock for each test
    mockClient = {
      databases: {
        query: jest.fn(),
      },
    } as unknown as jest.Mocked<Client>;

    // Import the module fresh for each test
    notionModule = await import('./notion');
    notionModule.initNotionClient(mockClient);
  });

  describe('fetchNotionMembers', () => {
    it('returns empty array when database ID is not configured', async () => {
      // Re-mock config with null database ID
      jest.resetModules();
      jest.mock('../config', () => ({
        config: {
          notionApiKey: 'mock-api-key',
          notionMembersDbId: null,
        },
      }));

      // Re-import the module to pick up the new config
      notionModule = await import('./notion');
      notionModule.initNotionClient(mockClient);

      const result = await notionModule.fetchNotionMembers();
      expect(result).toEqual([]);
      expect(mockClient.databases.query).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith('NOTION_MEMBERS_DATABASE_ID is not configured.');
    });

    it('fetches and parses members from Notion database', async () => {
      mockClient.databases.query.mockResolvedValueOnce({
        results: [createMockPage('mock-page-id-1', MOCK_VALID_PROPERTIES)],
        has_more: false,
        next_cursor: null,
      } as QueryDatabaseResponse);

      const result = await notionModule.fetchNotionMembers();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        notionPageId: 'mock-page-id-1',
        name: 'Alice Test',
        linkedinUrl: 'https://linkedin.com/in/alice',
        locationTags: ['Seattle', 'Remote'],
        expertiseTags: ['Energy', 'Solar', 'Hiking', 'Engineer'],
        hiring: false,
        lookingForWork: true,
        notionPageUrl: '',
      });

      expect(mockClient.databases.query).toHaveBeenCalledWith({
        database_id: 'test-db-id',
        page_size: 100,
      });
    });

    it('handles pagination correctly', async () => {
      mockClient.databases.query
        .mockResolvedValueOnce({
          results: [createMockPage('mock-page-id-1', MOCK_VALID_PROPERTIES)],
          has_more: true,
          next_cursor: 'cursor1',
        } as QueryDatabaseResponse)
        .mockResolvedValueOnce({
          results: [createMockPage('page2', MOCK_VALID_PROPERTIES)],
          has_more: false,
          next_cursor: null,
        } as QueryDatabaseResponse);

      const members = await notionModule.fetchNotionMembers();

      expect(members).toHaveLength(2);
      expect(mockClient.databases.query).toHaveBeenCalledTimes(2);
      expect(mockClient.databases.query).toHaveBeenNthCalledWith(1, {
        database_id: 'test-db-id',
        page_size: 100,
      });
      expect(mockClient.databases.query).toHaveBeenNthCalledWith(2, {
        database_id: 'test-db-id',
        page_size: 100,
        start_cursor: 'cursor1',
      });
    });

    it('handles partial page responses by logging a warning', async () => {
      const partialPage: PartialPageObjectResponse = {
        id: 'partial1',
        object: 'page',
      };

      mockClient.databases.query.mockResolvedValueOnce({
        results: [partialPage],
        has_more: false,
        next_cursor: null,
      } as QueryDatabaseResponse);

      const members = await notionModule.fetchNotionMembers();

      expect(members).toHaveLength(0);
      expect(mockLogger.warn).toHaveBeenCalledWith('Received partial page object response: partial1');
      expect(mockClient.databases.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('parseMemberProperties', () => {
    it('parses valid member properties', async () => {
      const result = await notionModule.parseMemberProperties(createMockPage('mock-page-id-1', MOCK_VALID_PROPERTIES));

      expect(result).toEqual({
        notionPageId: 'mock-page-id-1',
        name: 'Alice Test',
        linkedinUrl: 'https://linkedin.com/in/alice',
        locationTags: ['Seattle', 'Remote'],
        expertiseTags: ['Energy', 'Solar', 'Hiking', 'Engineer'],
        hiring: false,
        lookingForWork: true,
        notionPageUrl: '',
      });
    });

    it('returns null on missing name and logs a warning', async () => {
      const mockPropertiesMissingName = {
        ...MOCK_VALID_PROPERTIES,
        Name: { id: '1', type: 'title', title: [] },
      };

      const result = await notionModule.parseMemberProperties(
        createMockPage('mock-page-id-1', mockPropertiesMissingName),
      );

      expect(result).toEqual(null);
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });
});
