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
  getAllOfficeRnDMembersData: jest.fn(),
  getOfficeLocation: jest.fn(),
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
  getDocBySource: jest.fn(),
  deleteTypedDocumentsForMember: jest.fn(),
  insertOrUpdateDoc: jest.fn(),
};

export const mockProxycurlService = {
  getLinkedInProfile: jest.fn(),
};

export const mockSlackService = {
  getChannelId: jest.fn(),
  fetchChannelHistory: jest.fn(),
  processMessageBatch: jest.fn(),
};

export const mockLoggerService = {
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
};
