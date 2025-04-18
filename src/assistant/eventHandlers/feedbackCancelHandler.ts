import type { AllMiddlewareArgs, BlockAction, ButtonAction, SlackActionMiddlewareArgs } from '@slack/bolt/dist';

export const FEEDBACK_CANCEL_BUTTON_ACTION_ID = 'cancel_feedback_button';

export const handleFeedbackCancel = async ({
  ack,
  logger,
  respond,
}: SlackActionMiddlewareArgs<BlockAction<ButtonAction>> & AllMiddlewareArgs): Promise<void> => {
  await ack();
  logger.info('Feedback cancel shortcut received');

  await respond({
    response_type: 'ephemeral',
    replace_original: true,
    text: 'Feedback cancelled. React to any normal Fabric message in the future to send feedback.',
  });
};
