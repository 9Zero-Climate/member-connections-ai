import type { ChatCompletionUserMessageParam } from 'openai/resources/chat';
import type { ChatCompletionMessageToolCall } from 'openai/resources/chat';
import { logger } from '../services/logger';
import { DEFAULT_SYSTEM_CONTENT } from './constants';
import type { UserInfo } from './slackInteraction';
import type { ChatMessage } from './types';

export interface SlackMessage {
  channel: string;
  thread_ts?: string;
  text: string;
  ts: string;
  bot_id?: string;
  user?: string;
  subtype?: string;
  metadata?: {
    event_type?: string;
    event_payload?: { tool_call_id?: string; tool_calls?: ChatCompletionMessageToolCall[] };
  };
}

/**
 * Builds the initial message list for the LLM, including system prompts, history, and the current user message.
 */
export const buildInitialLlmThread = (
  history: ChatMessage[],
  userInfo: UserInfo,
  userMessageText: string,
  botUserId: string,
): ChatMessage[] => {
  const userMessage: ChatCompletionUserMessageParam = { role: 'user', content: userMessageText };

  const llmThread: ChatMessage[] = [
    { role: 'system', content: DEFAULT_SYSTEM_CONTENT },
    {
      role: 'system',
      content: `The current date and time is ${new Date().toISOString()} and your slack ID is ${botUserId}.`,
    },
    { role: 'system', content: 'Here is the conversation history (if any):' },
    ...history,
    {
      role: 'system',
      content: `The following message is from: ${JSON.stringify(userInfo)}`,
    },
    userMessage,
  ];
  logger.debug({ threadLength: llmThread.length, thread: llmThread }, 'LLM thread prepared');
  return llmThread;
};
