import type {
  AllMiddlewareArgs,
  BlockAction,
  ButtonAction,
  MessageShortcut,
  SlackActionMiddlewareArgs,
  SlackShortcutMiddlewareArgs,
  SlackViewMiddlewareArgs,
  ViewSubmitAction,
} from '@slack/bolt';
import type { Block, KnownBlock, View } from '@slack/web-api';
import { type FeedbackVote, saveFeedback } from '../../services/database';
import { logger } from '../../services/logger';

// Unique identifiers for the shortcut and the modal view
export const FEEDBACK_SHORTCUT_ID = 'give_feedback_shortcut';
export const FEEDBACK_MODAL_ID = 'feedback_modal';
export const FEEDBACK_ADD_REASON_BUTTON_ACTION_ID = 'add_feedback_reason_button';
const REASONING_BLOCK_ID = 'reasoning_block';
const REASONING_ACTION_ID = 'reasoning_action';

// Define the structure of the context passed from the button to the modalHome
export interface FeedbackContext {
  reaction: string;
  channelId: string;
  messageTs: string;
  originalMessageText: string;
}

const abbreviateAndQuoteMessage = (message: string): string => {
  const maxLength = 300;
  const suffix = message.length > maxLength ? ' [...]' : '';
  const abbreviatedMessage = message.slice(0, maxLength);
  return `> ${abbreviatedMessage.replace(/\n/g, '\n> ')}${suffix}`;
};

/**
 * Builds a feedback modal Slack Bolt view.
 * @param metadata - The metadata to store in the modal.
 * @returns The feedback modal view.
 */
const buildFeedbackModal = (metadata: string): View => {
  let context: FeedbackContext | null = null;
  context = JSON.parse(metadata) as FeedbackContext;
  logger.debug({ context }, 'Feedback context');

  return {
    type: 'modal',
    callback_id: FEEDBACK_MODAL_ID,
    private_metadata: metadata, // Store original message info + vote type
    title: {
      type: 'plain_text',
      text: 'Submitting feedback',
    },
    submit: {
      type: 'plain_text',
      text: 'Submit',
    },
    close: {
      type: 'plain_text',
      text: 'Cancel',
    },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `You reacted with ":${context?.reaction}:" to this message:`,
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: abbreviateAndQuoteMessage(context?.originalMessageText),
          },
        ],
      },
      {
        type: 'divider',
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'When you submit feedback, the thread will be provided to our development team for review.',
        },
      },
      {
        type: 'input',
        block_id: REASONING_BLOCK_ID,
        label: {
          type: 'plain_text',
          text: `Can you provide some background for the :${context?.reaction}:?`,
        },
        element: {
          type: 'plain_text_input',
          action_id: REASONING_ACTION_ID,
          multiline: true,
          placeholder: {
            type: 'plain_text',
            text: 'Explain your feedback...',
          },
        },
        optional: false,
      },
    ] as Array<KnownBlock | Block>, // Assert type for blocks array
  };
};

// Handler for the message shortcut
export const handleFeedbackShortcut = async ({
  shortcut,
  ack,
  client,
  logger: shortcutLogger,
}: SlackShortcutMiddlewareArgs<MessageShortcut> & AllMiddlewareArgs): Promise<void> => {
  await ack();
  shortcutLogger.info({ shortcut }, 'Feedback shortcut received');

  try {
    const triggerId = shortcut.trigger_id;
    // Extract original message details using correct type
    const { channel, message } = shortcut;
    const metadata = JSON.stringify({
      channelId: channel.id,
      messageTs: message.ts,
      // Potentially add message.user if you want the original author
    });

    await client.views.open({
      trigger_id: triggerId,
      view: buildFeedbackModal(metadata),
    });
    shortcutLogger.info({ triggerId, channel: channel.id, message: message.ts }, 'Feedback modal opened');
  } catch (error) {
    shortcutLogger.error({ error, shortcut }, 'Error handling feedback shortcut');
  }
};

const buildErrorView = (errorMessage: string): View => ({
  type: 'modal',
  callback_id: FEEDBACK_MODAL_ID, // Keep the same callback_id or use a different one if needed
  title: { type: 'plain_text', text: 'Error' },
  close: { type: 'plain_text', text: 'Close' },
  blocks: [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `:warning: ${errorMessage}` },
    },
  ] as Array<KnownBlock | Block>,
});

// --- Button Action Handler (Opens the Modal) ---
export const handleFeedbackAddReasonAction = async ({
  ack,
  body, // body contains the trigger_id and action details
  client,
  logger: actionLogger,
}: SlackActionMiddlewareArgs<BlockAction<ButtonAction>> & AllMiddlewareArgs): Promise<void> => {
  await ack();
  actionLogger.info({ action: body.actions[0] }, '"Send Feedback" button clicked');

  const triggerId = body.trigger_id;
  // Extract context stored in the button's value field
  const contextValue = body.actions[0]?.value; // First action should be our button

  if (!contextValue) {
    actionLogger.error({ actions: body.actions }, 'Missing context value in button action');
    // Maybe send an ephemeral message back?
    return;
  }

  // The contextValue should be the stringified FeedbackContext
  // No need to parse it here, just pass it directly to the modal builder
  const metadata = contextValue;

  await client.views.open({
    trigger_id: triggerId,
    view: buildFeedbackModal(metadata),
  });
  actionLogger.info({ triggerId, metadata }, 'Feedback reason modal opened');
};

// --- Modal Submission Handler ---
export const handleFeedbackViewSubmission = async ({
  view,
  ack,
  client,
  body, // Add body to access user ID reliably
  logger: viewLogger,
}: SlackViewMiddlewareArgs<ViewSubmitAction> & AllMiddlewareArgs): Promise<void> => {
  viewLogger.info({ viewId: view.id }, 'Feedback reason view submission received');

  let context: FeedbackContext | null = null;
  try {
    // Extract context from metadata
    context = JSON.parse(view.private_metadata) as FeedbackContext;
    const { channelId, messageTs, reaction } = context;

    // Extract reasoning from the view submission state
    const stateValues = view.state.values;
    const reasoningBlockState = stateValues[REASONING_BLOCK_ID]?.[REASONING_ACTION_ID];
    const reasoningInputValue =
      reasoningBlockState && 'value' in reasoningBlockState ? reasoningBlockState.value : null;

    // Basic validation
    if (!reasoningInputValue) {
      await ack({
        response_action: 'errors',
        errors: {
          [REASONING_BLOCK_ID]: 'Please provide reasoning.',
        },
      });
      viewLogger.warn({ context }, 'Missing reasoning in feedback submission');
      return;
    }

    // Prepare data for saving
    const feedbackData: FeedbackVote = {
      message_channel_id: channelId,
      message_ts: messageTs,
      submitted_by_user_id: body.user.id,
      reaction: reaction,
      reasoning: reasoningInputValue,
    };

    // Save to database
    await saveFeedback(feedbackData);
    viewLogger.info({ savedFeedbackData: feedbackData, user: body.user.id }, 'Feedback reason saved successfully');

    await client.chat.postEphemeral({
      channel: channelId,
      thread_ts: messageTs,
      user: body.user.id, // Use body.user.id here too
      text: 'Thanks for adding your feedback!',
    });

    await ack();
  } catch (error) {
    viewLogger.error(
      { error, viewId: view.id, metadata: view.private_metadata },
      'Error handling feedback view submission',
    );
    // Respond with an error update in the modal
    await ack({
      response_action: 'update',
      view: buildErrorView('Oops! There was an error saving your reasoning. Please try again later.'),
    });
  }
};
