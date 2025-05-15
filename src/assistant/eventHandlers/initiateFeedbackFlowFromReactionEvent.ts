import type { AllMiddlewareArgs } from '@slack/bolt';
import type { ReactionAddedEvent, WebClient } from '@slack/web-api';
import { logger } from '../../services/logger';
import { FEEDBACK_CANCEL_BUTTON_ACTION_ID } from './feedbackCancelHandler';
import { FEEDBACK_ADD_REASON_BUTTON_ACTION_ID, type FeedbackContext } from './feedbackHandler';
import { INITIAL_MESSAGES } from './threadStartedHandler';

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

const getResponseIntro = (originalMessageText: string | undefined, reactionName: string) => {
  if (originalMessageText && INITIAL_MESSAGES.includes(originalMessageText)) {
    // This is a response to our initial messages - do a special response
    if (reactionName === '+1' || reactionName === '-1') {
      return 'Yep, just like that :wink:!';
    }
    // response to our intial message, but with an unusual reaction.
    return `Getting fancy, eh! Yep, you can react with ":${reactionName}:" too.`;
  }
  // response to a message that wasn't one of our initial messages.
  return `I see your ":${reactionName}:" reaction!`;
};

export const truncateMessage = (message: string, maxLength = 300) => {
  const suffix = message.length > maxLength ? ' [...]' : '';
  const truncatedMessage = message.slice(0, maxLength);
  return `${truncatedMessage}${suffix}`;
};

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

  // We only include a truncated version of the original message text because the Slack API
  // imposes a character limit per block. It's supposedly 3000 characters per block, but in practice
  // it seems to be somewhat less
  const context: FeedbackContext = {
    reaction: reactionName,
    channelId: event.item.channel,
    messageTs: event.item.ts,
    truncatedMessageText: truncateMessage(originalMessageText || ''),
  };

  const contextString = JSON.stringify(context);

  const responseIntro = getResponseIntro(originalMessageText, reactionName);

  const responseText = `${responseIntro}\n\nWould you like to share feedback with the development team?\n\n If you send feedback, the thread will be provided to our development for review.`;
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
            style: 'primary',
            action_id: FEEDBACK_ADD_REASON_BUTTON_ACTION_ID,
            value: contextString,
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: "Don't send feedback",
            },
            style: 'danger',
            action_id: FEEDBACK_CANCEL_BUTTON_ACTION_ID,
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
