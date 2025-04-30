import type { ConversationsRepliesResponse, WebClient } from '@slack/web-api';
import { logger } from '../services/logger';

export interface UserInfo {
  slack_ID: string;
  preferred_name?: string;
  real_name?: string;
  time_zone?: string;
  time_zone_offset?: number;
  source?: string;
}

/**
 * Fetch the replies in a Slack thread.
 */
export const fetchSlackThread = async (
  client: WebClient,
  channel: string,
  thread_ts: string | undefined,
): Promise<ConversationsRepliesResponse['messages']> => {
  if (!thread_ts) {
    return [];
  }
  const slackThread = await client.conversations.replies({
    channel: channel,
    ts: thread_ts,
    include_all_metadata: true,
  });
  logger.debug({ slackThread }, 'Slack thread fetched');

  if (!slackThread.ok || !slackThread.messages) {
    throw new Error(`Failed to fetch thread replies: ${slackThread.error || 'Unknown error'}`);
  }
  return slackThread.messages;
};

export const fetchUserInfo = async (client: WebClient, userId: string): Promise<UserInfo> => {
  const userResponse = await client.users.info({ user: userId });
  if (!userResponse.ok || !userResponse.user) {
    throw new Error(`Failed to fetch user info for ${userId}: ${userResponse.error || 'Unknown error'}`);
  }
  const user = userResponse.user;
  const userProfile = user.profile;
  return {
    slack_ID: `<@${userId}>`,
    preferred_name: userProfile?.display_name || userProfile?.real_name_normalized,
    real_name: userProfile?.real_name,
    time_zone: user.tz,
    time_zone_offset: user.tz_offset,
  };
};

/**
 * Add +1/-1 reactions to a message to hint at the feedback flow.
 */
export const addFeedbackHintReactions = async (client: WebClient, channel: string, messageTs: string) => {
  logger.info({ messageTs: messageTs, channel }, 'Adding feedback reaction hints');
  await Promise.all([
    client.reactions.add({ name: '+1', channel: channel, timestamp: messageTs }),
    client.reactions.add({ name: '-1', channel: channel, timestamp: messageTs }),
  ]);
};

export const getBotUserId = async (client: WebClient): Promise<string> => {
  const authTest = await client.auth.test();
  if (!authTest.ok || !authTest.bot_id) {
    throw new Error('Could not fetch bot user ID via auth.test');
  }
  logger.info({ botUserId: authTest.bot_id }, 'Fetched bot user ID via auth.test');
  return authTest.bot_id;
};
