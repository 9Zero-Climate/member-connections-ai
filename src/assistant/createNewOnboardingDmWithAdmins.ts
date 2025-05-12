import type { WebClient } from '@slack/web-api';
import type { OfficeLocation } from '../services/database';
import { getMemberFromSlackId, getOnboardingConfig } from '../services/database';
import { logger } from '../services/logger';
import { getBotUserId } from './slackInteraction';

export const getSentenceAboutAdmins = (adminUserSlackIds: string[], location: OfficeLocation) => {
  const adminUserNames = adminUserSlackIds.map((id) => `<@${id}>`).join(' and ');
  const multipleAdmins = adminUserSlackIds.length > 1;
  return `${adminUserNames} ${multipleAdmins ? 'are' : 'is'} also on this thread. They're the admin ${multipleAdmins ? 'team ' : ''}for 9Zero in ${location} and can help with anything you need.`;
};

export async function getOfficeLocationFromSlackId(slackId: string): Promise<OfficeLocation> {
  const member = await getMemberFromSlackId(slackId);
  if (!member) {
    logger.info({ slackId }, 'Member not found for slack ID.');
    throw new Error('Member not found for slack ID.');
  }
  const location = member.location;
  if (!location) {
    logger.info(
      { slackId, member },
      'Location not found for member. Their location may not be synced from OfficeRnD yet.',
    );
    throw new Error('Location not found for member. Their location may not be synced from OfficeRnD yet.');
  }
  return location;
}

/**
 * Create a new onboarding thread with the admin users, the assistant, and the new user.
 * Welcomes the new user and sends the onboarding message content.
 */
export async function createNewOnboardingDmWithAdmins(client: WebClient, newUserSlackId: string): Promise<string> {
  const location = await getOfficeLocationFromSlackId(newUserSlackId);
  const { admin_user_slack_ids, onboarding_message_content } = await getOnboardingConfig(location);
  if (admin_user_slack_ids.length === 0) {
    throw new Error(`No admin users found for ${location}`);
  }

  const botUserId = await getBotUserId(client);

  const userIds = [...admin_user_slack_ids, botUserId, newUserSlackId];
  logger.info(`Creating new onboarding thread with users: ${userIds}`);
  const conversationOpenResponse = await client.conversations.open({
    users: userIds.join(','),
  });

  logger.info({ conversationOpenResponse }, 'Conversation open response');

  const channelId = conversationOpenResponse.channel?.id as string;

  const userInfo = await client.users.info({ user: newUserSlackId });
  const userName = userInfo.user?.real_name || userInfo.user?.name || newUserSlackId;
  await client.conversations.setTopic({
    channel: channelId,
    topic: `Welcome ${userName}!`,
  });

  // Post a welcome message mentioning the new user
  const welcomeText = `Hi <@${newUserSlackId}>! I'm Fabric, 9Zero's AI assistant for member connections.\n\nTag me anytime if you need help making connections based on interests and experience.\n\n ${getSentenceAboutAdmins(admin_user_slack_ids, location)}`;
  await client.chat.postMessage({
    channel: channelId,
    text: welcomeText,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: welcomeText,
        },
      },
    ],
  });

  if (onboarding_message_content) {
    await client.chat.postMessage({
      channel: channelId,
      text: onboarding_message_content,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: onboarding_message_content,
          },
        },
      ],
    });
  }
  return channelId;
}
