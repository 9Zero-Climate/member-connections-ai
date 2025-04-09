import type { AllMiddlewareArgs } from '@slack/bolt';
import type { ReactionAddedEvent, WebClient } from '@slack/web-api';
import { logger } from '../../services/logger';
import { ADD_REASON_BUTTON_ACTION_ID, type FeedbackContext } from './feedbackHandler';

// Store bot user ID - will be fetched once
let botUserId: string | undefined;

async function getBotUserId(client: WebClient): Promise<string> {
  if (botUserId) {
    return botUserId;
  }
  const authTest = await client.auth.test();
  botUserId = authTest.user_id;
  if (!botUserId) {
    throw new Error('Bot user ID not found in auth.test response');
  }

  logger.info({ botUserId }, 'Fetched bot user ID');
  return botUserId;
}

/**
 * Called when a reaction is added to a message.
 * If the reaction is on a message posted by the bot, this initiates a feedback prompt.
 *
 * @param event - The reaction added event
 * @param client - The Slack client
 */
export default async function initiateFeedbackFlowFromReactionEvent({
  event,
  client,
}: AllMiddlewareArgs & { event: ReactionAddedEvent }): Promise<void> {
  logger.debug({ event, user: event.user }, 'Reaction added event received');

  const reactionName = event.reaction;
  if (event.item.type !== 'message') {
    logger.debug({ itemType: event.item.type }, 'Ignoring reaction to non-message item');
    return;
  }

  // Check if the message was posted by *this* bot
  const currentBotUserId = await getBotUserId(client);
  if (event.item_user !== currentBotUserId) {
    logger.debug(
      { messageAuthorId: event.item_user, currentBotUserId },
      'Ignoring reaction to message not posted by this bot',
    );
    return;
  }

  logger.info(
    { item: event.item, reaction: reactionName, user: event.user },
    'Valid feedback reaction detected on bot message',
  );

  const reactionSubjectResponse = await client.conversations.replies({
    channel: event.item.channel,
    ts: event.item.ts,
    inclusive: true,
    include_all_metadata: true,
    limit: 1,
  });
  const originalMessageText = reactionSubjectResponse.messages?.[0]?.text;

  const context = {
    reaction: reactionName,
    channelId: event.item.channel,
    messageTs: event.item.ts,
    originalMessageText: originalMessageText,
  } as FeedbackContext;

  const contextString = JSON.stringify(context);

  const responseText = `I see your ":${reactionName}:" reaction! Would you like to share that feedback with the development team?\n\n If you send feedback, the thread will be provided to our development team for review.`;
  await client.chat.postEphemeral({
    channel: event.item.channel,
    thread_ts: event.item.ts,
    user: event.user,
    text: responseText,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: responseText,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Send Feedback',
              emoji: true,
            },
            action_id: ADD_REASON_BUTTON_ACTION_ID,
            value: contextString,
          },
        ],
      },
    ],
  });

  logger.info(
    { user: event.user, channel: event.item.channel, ts: event.item.ts },
    'Posted ephemeral prompt for feedback reason',
  );
}
