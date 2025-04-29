import { type App, Assistant } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import { OpenAI } from 'openai';
import type { Config } from '../config';
import { logger } from '../services/logger';
import { handleAppMention } from './eventHandlers/appMentionHandler';
import { FEEDBACK_CANCEL_BUTTON_ACTION_ID } from './eventHandlers/feedbackCancelHandler';
import { handleFeedbackCancel } from './eventHandlers/feedbackCancelHandler';
import {
  FEEDBACK_ADD_REASON_BUTTON_ACTION_ID,
  FEEDBACK_MODAL_ID,
  handleFeedbackAddReasonAction,
  handleFeedbackViewSubmission,
} from './eventHandlers/feedbackHandler';
import initiateFeedbackFlowFromReactionEvent from './eventHandlers/initiateFeedbackFlowFromReactionEvent';
import threadStartedHandler from './eventHandlers/threadStartedHandler';
import { handleUserMessage } from './eventHandlers/userMessageHandler';

export const registerAssistantAndHandlers = (app: App, config: Config, client: WebClient): void => {
  const openRouter = new OpenAI({
    apiKey: config.openRouterApiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': config.appUrl,
      'X-Title': config.appName,
    },
  });

  const assistant = new Assistant({
    threadStarted: threadStartedHandler,
    userMessage: (args) => handleUserMessage(openRouter, client, args),
  });

  app.assistant(assistant);

  app.event('reaction_added', initiateFeedbackFlowFromReactionEvent);
  app.event('app_mention', (args) => handleAppMention(openRouter, client, args));
  app.action(FEEDBACK_ADD_REASON_BUTTON_ACTION_ID, handleFeedbackAddReasonAction);
  app.action(FEEDBACK_CANCEL_BUTTON_ACTION_ID, handleFeedbackCancel);
  app.view(FEEDBACK_MODAL_ID, handleFeedbackViewSubmission);

  logger.info('Assistant and feedback/reaction handlers registered.');
};
