// Mocks must be declared before imports!
import { mockDatabaseService, mockLoggerService, mockSlackInteractionService } from '../services/mocks';

jest.mock('../services/database', () => mockDatabaseService);
jest.mock('./slackInteraction', () => mockSlackInteractionService);
jest.mock('../services/logger', () => mockLoggerService);

import type { WebClient } from '@slack/web-api';
import { OfficeLocation } from '../services/database';
import { createNewOnboardingDmWithAdmins, getSentenceAboutAdmins } from './createNewOnboardingDmWithAdmins';

describe('getSentenceAboutAdmins', () => {
  const testCases = [
    {
      name: 'single admin in Seattle',
      admins: ['U123'],
      location: OfficeLocation.SEATTLE,
      expected:
        "<@U123> is also on this thread. They're the admin for 9Zero in Seattle and can help with anything you need.",
    },
    {
      name: 'multiple admins in San Francisco',
      admins: ['U123', 'U456'],
      location: OfficeLocation.SAN_FRANCISCO,
      expected:
        "<@U123> and <@U456> are also on this thread. They're the admin team for 9Zero in San Francisco and can help with anything you need.",
    },
  ];

  it.each(testCases)('returns correct sentence for $name', ({ admins, location, expected }) => {
    const result = getSentenceAboutAdmins(admins, location);
    expect(result).toBe(expected);
  });
});

describe('createNewOnboardingDmWithAdmins', () => {
  let mockClient: jest.Mocked<WebClient>;

  // Default mock implementations
  const defaultOnboardingConfig = {
    admin_user_slack_ids: ['UADMIN'],
    onboarding_message_content: 'Default welcome message!',
  };
  const defaultBotId = 'BBOT';
  const defaultBotUserId = 'UBOT';
  const defaultChannelId = 'C123';
  const defaultTeamId = 'T00000000';
  const defaultUserInfo = { user: { real_name: 'Alice' } };

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();

    // Setup default mock behaviors
    mockDatabaseService.getOnboardingConfig.mockResolvedValue(defaultOnboardingConfig);
    mockSlackInteractionService.getBotIds.mockResolvedValue({
      botId: defaultBotId,
      userId: defaultBotUserId,
    });
    mockDatabaseService.getMemberFromSlackId.mockResolvedValue({ location: OfficeLocation.SEATTLE });

    mockClient = {
      conversations: {
        open: jest.fn().mockResolvedValue({ channel: { id: defaultChannelId, context_team_id: defaultTeamId } }),
        setTopic: jest.fn(),
      },
      users: {
        info: jest.fn().mockResolvedValue(defaultUserInfo),
      },
      chat: {
        postMessage: jest.fn(),
      },
    } as unknown as jest.Mocked<WebClient>;
  });

  it('creates a DM, sets topic, and posts onboarding messages', async () => {
    const newUserSlackId = 'UNEWUSER';
    const location = OfficeLocation.SEATTLE;

    const channelLink = await createNewOnboardingDmWithAdmins(mockClient, newUserSlackId);

    expect(mockDatabaseService.getMemberFromSlackId).toHaveBeenCalledWith(newUserSlackId);
    expect(mockDatabaseService.getOnboardingConfig).toHaveBeenCalledWith(location);
    expect(mockSlackInteractionService.getBotIds).toHaveBeenCalledWith(mockClient);
    expect(mockClient.conversations.open).toHaveBeenCalledWith({ users: 'UADMIN,UBOT,UNEWUSER' });
    expect(mockClient.conversations.setTopic).toHaveBeenCalledWith({
      channel: defaultChannelId,
      topic: 'Welcome Alice!',
    });
    // Check first welcome message
    expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: defaultChannelId,
        text: expect.stringContaining(`Hi <@${newUserSlackId}>!`), // More specific check
        blocks: expect.any(Array),
      }),
    );
    // Check specific onboarding message
    expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: defaultChannelId,
        text: defaultOnboardingConfig.onboarding_message_content,
        blocks: expect.any(Array),
      }),
    );
    expect(channelLink).toBe(`slack://channel?team=${defaultTeamId}&id=${defaultChannelId}`);
    expect(mockClient.chat.postMessage).toHaveBeenCalledTimes(2);
  });

  it('throws if no admin users found', async () => {
    // Override default mock behavior for this specific test
    mockDatabaseService.getOnboardingConfig.mockResolvedValue({
      admin_user_slack_ids: [],
      onboarding_message_content: 'irrelevant',
    });

    await expect(createNewOnboardingDmWithAdmins(mockClient, 'UNEWUSER')).rejects.toThrow(
      'No admin users found for Seattle',
    );
    expect(mockClient.conversations.open).not.toHaveBeenCalled();
    expect(mockClient.chat.postMessage).not.toHaveBeenCalled();
  });

  it('posts only welcome message if onboarding_message_content is empty', async () => {
    // Override default mock behavior
    mockDatabaseService.getOnboardingConfig.mockResolvedValue({
      admin_user_slack_ids: ['UADMIN'],
      onboarding_message_content: '', // Empty content
    });
    mockClient.users.info = jest.fn().mockResolvedValue({ user: { real_name: 'Bob' } }); // Different user name
    mockDatabaseService.getMemberFromSlackId.mockResolvedValue({ location: OfficeLocation.SAN_FRANCISCO }); // Mock location lookup for this case

    const newUserSlackId = 'UNEWUSER';
    await createNewOnboardingDmWithAdmins(mockClient, newUserSlackId);

    expect(mockClient.conversations.setTopic).toHaveBeenCalledWith({
      channel: defaultChannelId,
      topic: 'Welcome Bob!',
    });
    expect(mockClient.chat.postMessage).toHaveBeenCalledTimes(1);
    expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: defaultChannelId,
        text: expect.stringContaining(`Hi <@${newUserSlackId}>!`), // Check welcome message
        blocks: expect.any(Array),
      }),
    );
  });

  it('throws if member location cannot be determined', async () => {
    mockDatabaseService.getMemberFromSlackId.mockResolvedValue(null); // Simulate member not found or no location

    await expect(createNewOnboardingDmWithAdmins(mockClient, 'UNKNOWNUSER')).rejects.toThrow(
      'Member not found for slack ID.',
    );
    // Ensure no further actions were taken
    expect(mockDatabaseService.getOnboardingConfig).not.toHaveBeenCalled();
    expect(mockClient.conversations.open).not.toHaveBeenCalled();
  });
});
