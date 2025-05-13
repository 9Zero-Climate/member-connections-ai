import { mockDatabaseService, mockLoggerService, mockOfficeRndService } from '../services/mocks'; // These have to be imported before the libraries they are going to mock are imported
import type {
  OfficeRnDMemberData,
  OfficeRnDRawCheckinData,
  OfficeRnDRawMemberData,
  OfficeRnDRawWebhookPayload,
} from '../services/officernd';
import {
  createOfficeRnDDocuments,
  handleCheckinEvent,
  handleMemberEvent,
  handleOfficeRnDWebhook,
  syncOfficeRnD,
} from './officernd';

jest.mock('../services/officernd', () => mockOfficeRndService);
jest.mock('../services/database', () => mockDatabaseService);
jest.mock('../services/logger', () => mockLoggerService);

// Test fixtures
const TEST_MEMBER_ID = 'member-id-1';
const TEST_OFFICE_ID = 'office-id-1';
const TEST_EVENT_ID = 'event-id-1';
const TEST_USER_ID = 'user-id-1';
const TEST_TIMESTAMP = '2023-01-01T00:00:00Z';
const TEST_LOCATION = 'Seattle';
const TEST_SLACK_ID = 'U123';
const TEST_MEMBER_NAME = 'Test User';

// Member fixtures
const mockMember1 = {
  id: '1',
  name: 'John Doe',
  slackId: 'U123',
  linkedinUrl: 'https://linkedin.com/in/johndoe',
  location: TEST_LOCATION,
} as OfficeRnDMemberData;

const mockMember2 = {
  id: '2',
  name: 'Jane Smith',
  slackId: 'U456',
  linkedinUrl: 'https://linkedin.com/in/janesmith',
  location: 'San Francisco',
} as OfficeRnDMemberData;

const mockMembersData = [mockMember1, mockMember2];

// Common database records
const dbMember1 = {
  officernd_id: '1',
  name: 'John Doe',
  slack_id: 'U123',
  linkedin_url: 'https://linkedin.com/in/johndoe',
  location: TEST_LOCATION,
};

const dbMember2 = {
  officernd_id: '2',
  name: 'Jane Smith',
  slack_id: 'U456',
  linkedin_url: 'https://linkedin.com/in/janesmith',
  location: 'San Francisco',
};

// Webhook payload fixtures
const createBasicPayload = <T extends OfficeRnDRawCheckinData | OfficeRnDRawMemberData>(
  eventType: string,
  objectData: T,
): OfficeRnDRawWebhookPayload => ({
  event: TEST_EVENT_ID,
  eventType,
  data: { object: objectData },
  createdAt: TEST_TIMESTAMP,
});

const createMemberPayload = (eventType: string, status = 'active'): OfficeRnDRawWebhookPayload => {
  const memberData: OfficeRnDRawMemberData = {
    _id: TEST_MEMBER_ID,
    calculatedStatus: status,
    name: TEST_MEMBER_NAME,
    office: '',
    properties: {},
  };
  return createBasicPayload(eventType, memberData);
};

const createCheckinPayload = (
  eventType = 'checkin.created',
  endDate: string | null = null,
): OfficeRnDRawWebhookPayload => {
  const checkinData: OfficeRnDRawCheckinData = {
    member: TEST_MEMBER_ID,
    office: TEST_OFFICE_ID,
    start: TEST_TIMESTAMP,
    end: endDate,
    createdAt: TEST_TIMESTAMP,
    createdBy: TEST_USER_ID,
  };
  return createBasicPayload(eventType, checkinData);
};

const VALID_ENV_VARS = {
  DB_URL: 'postgresql://postgres.test',
  OPENAI_API_KEY: 'test-open-api-key',
  OFFICERND_API_URL: 'https://test.officernd.com',
  OFFICERND_ORG_SLUG: 'test-org',
  OFFICERND_CLIENT_ID: 'test-client-id',
  OFFICERND_CLIENT_SECRET: 'test-client-secret',
};

describe('syncOfficeRnD', () => {
  // Store original env vars
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = VALID_ENV_VARS;
    jest.clearAllMocks();
  });

  afterAll(() => {
    jest.resetAllMocks();
    // Restore original environment
    process.env = originalEnv;
  });

  it('syncs members successfully', async () => {
    mockOfficeRndService.getAllActiveOfficeRnDMembersData.mockResolvedValue(mockMembersData);

    await syncOfficeRnD();

    expect(mockOfficeRndService.getAllActiveOfficeRnDMembersData).toHaveBeenCalledTimes(1);
    expect(mockDatabaseService.bulkUpsertMembers).toHaveBeenCalledTimes(1);
    expect(mockDatabaseService.bulkUpsertMembers).toHaveBeenCalledWith([dbMember1, dbMember2]);
  });

  it.each([
    {
      name: 'API error',
      setup: () => mockOfficeRndService.getAllActiveOfficeRnDMembersData.mockRejectedValueOnce(new Error('API Error')),
      expectedError: 'API Error',
    },
    {
      name: 'missing environment variables',
      setup: () => {
        process.env = {};
      },
      expectedError: /^Missing required environment variables/,
    },
  ])('throws on error: $name', async ({ setup, expectedError }) => {
    setup();
    await expect(syncOfficeRnD()).rejects.toThrow(expectedError);
  });

  it('closes db connection even after error', async () => {
    mockOfficeRndService.getAllActiveOfficeRnDMembersData.mockRejectedValueOnce(new Error());

    await expect(syncOfficeRnD()).rejects.toThrow();
    expect(mockDatabaseService.closeDbConnection).toHaveBeenCalledTimes(1);
  });
});

describe('createOfficeRnDDocuments', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create all document types', async () => {
    await createOfficeRnDDocuments({
      ...mockMember1,
      sector: ['Energy', 'Agriculture'],
      subsector: 'Regnerative',
      currentRole: 'CTO',
      blurb: 'Carbon credits for regenerative agriculture',
      type: ['Startup'],
    });

    // Verify document creation
    expect(mockDatabaseService.insertOrUpdateDoc).toHaveBeenCalledTimes(2); // expertise, blurb

    // Verify exertise document
    expect(mockDatabaseService.insertOrUpdateDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        source_type: 'officernd_expertise',
        source_unique_id: 'officernd_member_1:officernd_expertise',
        content: 'Expertise and interests: Energy, Agriculture, Regnerative, CTO, Startup',
        metadata: expect.objectContaining({
          member_name: 'John Doe',
          tags: ['Energy', 'Agriculture', 'Regnerative', 'CTO', 'Startup'],
        }),
      }),
    );

    // Verify blurb document
    expect(mockDatabaseService.insertOrUpdateDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        source_type: 'officernd_blurb',
        source_unique_id: 'officernd_member_1:officernd_blurb',
        content: 'Talk to me about: Carbon credits for regenerative agriculture',
        metadata: expect.objectContaining({
          member_name: 'John Doe',
        }),
      }),
    );
  });

  it('does not create documents if relevant properties missing', async () => {
    await createOfficeRnDDocuments(mockMember1);

    // Verify no documents were created
    expect(mockDatabaseService.insertOrUpdateDoc).not.toHaveBeenCalled();
  });

  it('should handle missing experience fields', async () => {
    await createOfficeRnDDocuments({
      ...mockMember1,
      sector: ['Energy', 'Agriculture'],
      currentRole: 'CTO',
    });

    // Verify experience document was created with null fields
    expect(mockDatabaseService.insertOrUpdateDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Expertise and interests: Energy, Agriculture, CTO',
        metadata: expect.objectContaining({
          member_name: 'John Doe',
          tags: ['Energy', 'Agriculture', 'CTO'],
        }),
      }),
    );
  });
});

describe('handleCheckinEvent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOfficeRndService.getOfficeLocation.mockReturnValue(TEST_LOCATION);
  });

  it.each([
    {
      name: 'sets location when end is null',
      payload: createCheckinPayload(),
      expectedLocation: TEST_LOCATION,
    },
    {
      name: 'sets null when end is not null',
      payload: createCheckinPayload('checkin.created', TEST_TIMESTAMP),
      expectedLocation: null,
    },
  ])('$name', async ({ payload, expectedLocation }) => {
    await handleCheckinEvent(payload);
    expect(mockDatabaseService.updateMember).toHaveBeenCalledWith(TEST_MEMBER_ID, {
      checkin_location_today: expectedLocation,
    });
  });

  it.each([
    {
      name: 'unsupported event type',
      payload: createCheckinPayload('checkin.removed'),
      expectedError: /Unsupported event type/,
    },
    {
      name: 'missing office',
      payload: createBasicPayload('checkin.created', {
        member: TEST_MEMBER_ID,
        start: TEST_TIMESTAMP,
        end: null,
        createdAt: TEST_TIMESTAMP,
        createdBy: TEST_USER_ID,
      }),
      expectedError: /checkin.office missing/,
    },
  ])('throws error for $name', async ({ payload, expectedError }) => {
    await expect(handleCheckinEvent(payload)).rejects.toThrow(expectedError);
  });
});

describe('handleMemberEvent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOfficeRndService.cleanMember.mockImplementation((member) => ({
      id: member._id,
      name: TEST_MEMBER_NAME,
      slackId: TEST_SLACK_ID,
      linkedinUrl: null,
      location: TEST_LOCATION,
    }));

    // Mock DB calls
    mockDatabaseService.getMembersWithLastLinkedInUpdates.mockResolvedValue([
      {
        id: TEST_MEMBER_ID,
        name: TEST_MEMBER_NAME,
        linkedin_url: null,
        last_linkedin_update: Date.now(),
      },
    ]);
    mockDatabaseService.updateLinkedinForOfficerndIdIfNeeded.mockResolvedValue(undefined);
  });

  it.each([
    {
      name: 'deletes inactive member',
      payload: createMemberPayload('member.updated', 'inactive'),
      expectDelete: true,
      expectUpsert: false,
    },
    {
      name: 'upserts active member',
      payload: createMemberPayload('member.updated', 'active'),
      expectDelete: false,
      expectUpsert: true,
    },
  ])('$name', async ({ payload, expectDelete, expectUpsert }) => {
    await handleMemberEvent(payload);

    if (expectDelete) {
      expect(mockDatabaseService.deleteMember).toHaveBeenCalledWith(TEST_MEMBER_ID);
      expect(mockDatabaseService.deleteTypedDocumentsForMember).toHaveBeenCalledWith(TEST_MEMBER_ID, 'officernd_');
      expect(mockDatabaseService.deleteLinkedinDocumentsForOfficerndId).toHaveBeenCalledWith(TEST_MEMBER_ID);
      expect(mockDatabaseService.bulkUpsertMembers).not.toHaveBeenCalled();
    }

    if (expectUpsert) {
      expect(mockOfficeRndService.cleanMember).toHaveBeenCalled();
      expect(mockDatabaseService.bulkUpsertMembers).toHaveBeenCalledWith([
        {
          officernd_id: TEST_MEMBER_ID,
          name: TEST_MEMBER_NAME,
          slack_id: TEST_SLACK_ID,
          linkedin_url: null,
          location: TEST_LOCATION,
        },
      ]);
      expect(mockDatabaseService.deleteTypedDocumentsForMember).toHaveBeenCalledWith(TEST_MEMBER_ID, 'officernd_');
    }
  });
});

describe('handleOfficeRnDWebhook', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Add mockImplementation for cleanMember here to ensure it's available
    mockOfficeRndService.cleanMember.mockImplementation((member) => ({
      id: member._id,
      name: TEST_MEMBER_NAME,
      slackId: TEST_SLACK_ID,
      linkedinUrl: null,
      location: TEST_LOCATION,
    }));

    // Mock the LinkedIn update check to avoid errors
    mockDatabaseService.getMembersWithLastLinkedInUpdates.mockResolvedValue([
      {
        id: TEST_MEMBER_ID,
        name: TEST_MEMBER_NAME,
        linkedin_url: null,
        last_linkedin_update: Date.now(),
      },
    ]);

    // Mock office location
    mockOfficeRndService.getOfficeLocation.mockReturnValue(TEST_LOCATION);
  });

  it.each([
    {
      name: 'checkin events',
      payload: createCheckinPayload(),
      expectUpdateMember: true,
      expectBulkUpsert: false,
      expectError: false,
    },
    {
      name: 'member events',
      payload: createMemberPayload('member.created'),
      expectUpdateMember: false,
      expectBulkUpsert: true,
      expectError: false,
    },
    {
      name: 'unsupported events',
      payload: {
        event: TEST_EVENT_ID,
        eventType: 'unsupported.event',
        data: {
          object: {
            _id: TEST_MEMBER_ID,
            calculatedStatus: 'active',
            name: TEST_MEMBER_NAME,
            office: '',
            properties: {},
          } as OfficeRnDRawMemberData,
        },
        createdAt: TEST_TIMESTAMP,
      },
      expectUpdateMember: false,
      expectBulkUpsert: false,
      expectError: true,
    },
  ])('routes $name correctly', async ({ payload, expectUpdateMember, expectBulkUpsert, expectError }) => {
    if (expectError) {
      await expect(handleOfficeRnDWebhook(payload)).rejects.toThrow(/Unsupported event type/);
      return;
    }

    await handleOfficeRnDWebhook(payload);

    if (expectUpdateMember) {
      expect(mockDatabaseService.updateMember).toHaveBeenCalled();
    }

    if (expectBulkUpsert) {
      expect(mockDatabaseService.bulkUpsertMembers).toHaveBeenCalled();
    }
  });
});
