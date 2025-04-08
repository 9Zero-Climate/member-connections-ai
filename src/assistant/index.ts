import { App, Assistant } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import { OpenAI } from 'openai';
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionSystemMessageParam,
  ChatCompletionToolMessageParam,
  ChatCompletionUserMessageParam,
} from 'openai/resources/chat';
import type { Config } from '../config';
import threadStartedHandler from './eventHandlers/threadStartedHandler';
import { getUserMessageHandler } from './eventHandlers/userMessageHandler';

export type ChatMessage =
  | ChatCompletionSystemMessageParam
  | ChatCompletionUserMessageParam
  | ChatCompletionAssistantMessageParam
  | ChatCompletionToolMessageParam;

export const getAssistant = (config: Config, client: WebClient): Assistant => {
  const openRouter = new OpenAI({
    apiKey: config.openRouterApiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': config.appUrl,
      'X-Title': config.appName,
    },
  });

  return new Assistant({
    threadStarted: threadStartedHandler,
    userMessage: getUserMessageHandler(openRouter, client),
  });
};
