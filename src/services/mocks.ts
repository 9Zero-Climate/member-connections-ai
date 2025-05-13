export const mockEmbeddingsService = {
  generateEmbedding: jest.fn(),
  generateEmbeddings: jest.fn(),
  client: {
    embeddings: {
      create: jest.fn(),
    },
  },
};

export const mockOfficeRndService = {
  getAllActiveOfficeRnDMembersData: jest.fn(),
  getOfficeLocation: jest.fn(),
  cleanMember: jest.fn(),
  OFFICERND_ACTIVE_MEMBER_STATUS: 'active',
};

export const mockNotionService = {
  fetchNotionMembers: jest.fn(),
};

export const mockDatabaseService = {
  bulkUpsertMembers: jest.fn(),
  closeDbConnection: jest.fn(),
  updateMember: jest.fn(),
  updateMembersFromNotion: jest.fn(),
  getMembersWithLastLinkedInUpdates: jest.fn(),
  getLastLinkedInUpdateForMember: jest.fn(),
  getDocBySource: jest.fn(),
  deleteTypedDocumentsForMember: jest.fn(),
  insertOrUpdateDoc: jest.fn(),
  getOnboardingConfig: jest.fn(),
  getMemberFromSlackId: jest.fn(),
  getMember: jest.fn(),
  deleteMember: jest.fn(),
  deleteLinkedinDocumentsForOfficerndId: jest.fn(),
  updateLinkedinForOfficerndIdIfNeeded: jest.fn(),
  OfficeLocation: {
    SEATTLE: 'Seattle',
    SAN_FRANCISCO: 'San Francisco',
  },
};

export const mockProxycurlService = {
  getLinkedInProfile: jest.fn(),
};

export const mockSlackService = {
  getChannelId: jest.fn(),
  fetchChannelHistory: jest.fn(),
  processMessageBatch: jest.fn(),
};

export const mockSlackInteractionService = {
  getBotUserId: jest.fn(),
};

export const mockLoggerService = {
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
};
