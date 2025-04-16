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

// Mock the logger
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

describe('Notion Service', () => {
  let mockClient: jest.Mocked<Client>;
  let notionModule: typeof import('./notion');

  beforeEach(async () => {
    // Clear all mocks
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

  // Helper to create a mock PageObjectResponse (partial but typed)
  type MockProperties = PageObjectResponse['properties'];
  const createMockPage = (
    id: string,
    properties: MockProperties,
  ): Partial<PageObjectResponse> & { object: 'page'; id: string } => ({
    object: 'page',
    id: id,
    properties: properties,
    // Add other necessary fields if your parsing logic depends on them
    // e.g., created_time, last_edited_time, parent, etc.
    // For this test, only properties are needed by parseMemberProperties
  });

  // --- Test Data (using the helper) ---
  const mockPage1Properties: MockProperties = {
    Name: {
      id: '1',
      type: 'title',
      title: [
        {
          type: 'text',
          text: { content: 'Alice', link: null },
          annotations: defaultAnnotations,
          plain_text: 'Alice',
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
  const mockPage1 = createMockPage('page1', mockPage1Properties);

  const mockPage2Properties: MockProperties = {
    Name: {
      id: '11',
      type: 'title',
      title: [
        {
          type: 'text',
          text: { content: 'Bob', link: null },
          annotations: defaultAnnotations,
          plain_text: 'Bob',
          href: null,
        },
      ],
    },
    LinkedIn: { id: '12', type: 'url', url: null }, // No LinkedIn
    Location: { id: '13', type: 'multi_select', multi_select: [{ id: 'ms6', name: 'New York', color: 'orange' }] },
    Sectors: { id: '14', type: 'multi_select', multi_select: [{ id: 'ms7', name: 'Finance', color: 'yellow' }] },
    'Sub-Sector': { id: '15', type: 'rich_text', rich_text: [] }, // Empty rich text
    'Hobbies/Interests': { id: '16', type: 'multi_select', multi_select: [] }, // Empty multi-select
    'Role (Current or Experienced)': {
      id: '17',
      type: 'multi_select',
      multi_select: [{ id: 'ms8', name: 'Analyst', color: 'pink' }],
    },
    'Role (Interested)': {
      id: '18',
      type: 'multi_select',
      multi_select: [{ id: 'ms9', name: 'Manager', color: 'brown' }],
    },
    'Hiring?': { id: '19', type: 'checkbox', checkbox: true },
    'Open for work?': { id: '20', type: 'checkbox', checkbox: false },
  };
  const mockPage2 = createMockPage('page2', mockPage2Properties);

  const mockPageNoNameProperties: MockProperties = {
    Name: { id: '21', type: 'title', title: [] }, // Empty title array
    Location: { id: '22', type: 'multi_select', multi_select: [{ id: 'ms10', name: 'London', color: 'red' }] },
  };
  const mockPageNoName = createMockPage('page3', mockPageNoNameProperties);

  const mockPageMissingPropsProperties: MockProperties = {
    Name: {
      id: '23',
      type: 'title',
      title: [
        {
          type: 'text',
          text: { content: 'Charlie', link: null },
          annotations: defaultAnnotations,
          plain_text: 'Charlie',
          href: null,
        },
      ],
    },
    // Missing other properties
  };
  const mockPageMissingProps = createMockPage('page4', mockPageMissingPropsProperties);

  // --- Tests ---
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
      const mockResponse: Partial<QueryDatabaseResponse> = {
        results: [
          {
            id: 'page-id-1',
            object: 'page',
            properties: {
              Name: {
                type: 'title',
                title: [{ plain_text: 'Test User', type: 'text' }],
              },
              LinkedIn: {
                type: 'url',
                url: 'https://linkedin.com/test',
              },
              Location: {
                type: 'multi_select',
                multi_select: [{ name: 'New York' }],
              },
              Sectors: {
                type: 'multi_select',
                multi_select: [{ name: 'Tech' }],
              },
              'Hobbies/Interests': {
                type: 'multi_select',
                multi_select: [{ name: 'Coding' }],
              },
              'Role (Current or Experienced)': {
                type: 'multi_select',
                multi_select: [{ name: 'Engineer' }],
              },
              'Role (Interested)': {
                type: 'multi_select',
                multi_select: [{ name: 'Manager' }],
              },
              'Hiring?': {
                type: 'checkbox',
                checkbox: true,
              },
              'Open for work?': {
                type: 'checkbox',
                checkbox: false,
              },
            },
          } as PageObjectResponse,
        ],
        has_more: false,
        next_cursor: null,
      };

      mockClient.databases.query.mockResolvedValueOnce(mockResponse as QueryDatabaseResponse);

      const result = await notionModule.fetchNotionMembers();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        notionPageId: 'page-id-1',
        name: 'Test User',
        linkedinUrl: 'https://linkedin.com/test',
        locationTags: ['New York'],
        expertiseTags: ['Tech', 'Coding', 'Engineer', 'Manager'],
        hiring: true,
        lookingForWork: false,
        notionPageUrl: '',
      });

      expect(mockClient.databases.query).toHaveBeenCalledWith({
        database_id: 'test-db-id',
        page_size: 100,
      });
    });

    it('should handle pagination correctly', async () => {
      const mockPage1 = {
        id: 'page1',
        object: 'page',
        properties: {
          Name: {
            type: 'title',
            title: [{ plain_text: 'User 1', type: 'text' }],
          },
        },
      } as PageObjectResponse;

      const mockPage2 = {
        id: 'page2',
        object: 'page',
        properties: {
          Name: {
            type: 'title',
            title: [{ plain_text: 'User 2', type: 'text' }],
          },
        },
      } as PageObjectResponse;

      mockClient.databases.query
        .mockResolvedValueOnce({
          results: [mockPage1],
          has_more: true,
          next_cursor: 'cursor1',
        } as QueryDatabaseResponse)
        .mockResolvedValueOnce({
          results: [mockPage2],
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

    it('should handle partial page responses by logging a warning', async () => {
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
});
