import type {
  ConversationsHistoryArguments,
  ConversationsRepliesArguments,
  ConversationsRepliesResponse,
  WebClient,
} from '@slack/web-api';
import type { MessageElement } from '@slack/web-api/dist/types/response/ConversationsRepliesResponse';
import { logger } from '../services/logger';

// The maximum number of messages that can be fetched from Slack in a single API call.
// Since Slack doesn't return messages in order, we need to fetch as many as we can and sort them ourselves, even if we will truncate later.
const MAX_FETCHABLE_MESSAGES = 999;

export interface UserInfo {
  slack_ID: string;
  preferred_name?: string;
  real_name?: string;
  time_zone?: string;
  time_zone_offset?: number;
  source?: string;
}

const sortSlackMessagesByTimestamp = (messages: MessageElement[] | undefined): MessageElement[] => {
  if (!messages) {
    return [];
  }
  return messages.sort((a, b) => {
    if (!a.ts || !b.ts) {
      return 0;
    }
    return Number(a.ts) - Number(b.ts);
  });
};

/**
 * Fetch the replies in a Slack thread.
 */
export const fetchSlackThreadMessages = async (
  client: WebClient,
  channel: string,
  thread_ts: string,
  additional_api_args: Partial<ConversationsRepliesArguments> = {},
): Promise<MessageElement[]> => {
  const slackThread = await client.conversations.replies({
    channel: channel,
    ts: thread_ts,
    include_all_metadata: true,
    limit: MAX_FETCHABLE_MESSAGES,
    ...additional_api_args,
  });
  logger.debug({ slackThread }, 'Slack thread fetched');

  return sortSlackMessagesByTimestamp(slackThread.messages);
};

/**
 * Fetch the messages in a Slack channel
 * A channel is generally the parent to a thread and does not contain threaded messages unless they were also posted in the channel.
 */
export const fetchSlackChannelMessages = async (
  client: WebClient,
  channel: string,
  additional_api_args: Partial<ConversationsHistoryArguments> = {},
): Promise<MessageElement[]> => {
  const conversationHistory = await client.conversations.history({
    channel: channel,
    include_all_metadata: true,
    limit: MAX_FETCHABLE_MESSAGES,
    ...additional_api_args,
  });

  logger.debug({ conversationHistory }, 'Channel history fetched');

  return sortSlackMessagesByTimestamp(conversationHistory.messages);
};

// Constants for fetching an appropriate amount of context
// We fetch up to a day's worth of messages from the channel leading up to the thread.
const ONE_DAY_IN_S = 24 * 60 * 60;
const MAX_CHANNEL_MESSAGE_AGE = ONE_DAY_IN_S;
// Max number of channel messages to fetch
// Keeping this kind of low since older channel messages are more likely to be irrelevant to the thread.
const MAX_CHANNEL_MESSAGES = 10;
// Max number of messages to fetch in total, in cases where we are fetching both thread and channel messages.
const TOTAL_MESSAGES_LIMIT = 100;

/* Fetch the messages from a slack thread, along with some of the channel context leading up to it.
 *
 * You probably don't want to do this in an Assistant DM thread, since in that case the "channel"
 * consists of the first messages of each Assistant thread, which is pretty meaningless.
 */
export const fetchSlackThreadAndChannelContext = async (
  client: WebClient,
  channel: string,
  thread_ts: string,
): Promise<ConversationsRepliesResponse['messages']> => {
  const threadMessages = await fetchSlackThreadMessages(client, channel, thread_ts);

  const oneDayAgo = (Number(thread_ts) - MAX_CHANNEL_MESSAGE_AGE).toString();
  logger.info({ channel, oneDayAgo, thread_ts }, 'Fetching channel messages');
  const channelMessages = await fetchSlackChannelMessages(client, channel, {
    oldest: oneDayAgo,
    latest: thread_ts,
    inclusive: false, // Exclude the thread message itself: that will be included in the threadMessages
  });
  logger.debug({ numChannelMessages: channelMessages.length }, 'Channel messages fetched');
  const limitedChannelMessages = channelMessages ? channelMessages.slice(-MAX_CHANNEL_MESSAGES) : [];

  return [...limitedChannelMessages, ...(threadMessages || [])].slice(-TOTAL_MESSAGES_LIMIT);
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
