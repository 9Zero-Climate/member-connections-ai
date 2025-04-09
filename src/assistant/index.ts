import { type App, Assistant } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import { OpenAI } from 'openai';
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionSystemMessageParam,
  ChatCompletionToolMessageParam,
  ChatCompletionUserMessageParam,
} from 'openai/resources/chat';
import type { Config } from '../config';
import { logger } from '../services/logger';
import {
  ADD_REASON_BUTTON_ACTION_ID,
  FEEDBACK_MODAL_ID,
  handleFeedbackAddReasonAction,
  handleFeedbackViewSubmission,
} from './eventHandlers/feedbackHandler';
import initiateFeedbackFlowFromReactionEvent from './eventHandlers/initiateFeedbackFlowFromReactionEvent';
import threadStartedHandler from './eventHandlers/threadStartedHandler';
import { getUserMessageHandler } from './eventHandlers/userMessageHandler';

export type ChatMessage =
  | ChatCompletionSystemMessageParam
  | ChatCompletionUserMessageParam
  | ChatCompletionAssistantMessageParam
  | ChatCompletionToolMessageParam;

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
    userMessage: getUserMessageHandler(openRouter, client),
  });

  app.assistant(assistant);

  app.event('reaction_added', initiateFeedbackFlowFromReactionEvent);
  app.action(ADD_REASON_BUTTON_ACTION_ID, handleFeedbackAddReasonAction);
  app.view(FEEDBACK_MODAL_ID, handleFeedbackViewSubmission);

  logger.info('Assistant and feedback/reaction handlers registered.');
};
