import type { ChatCompletionUserMessageParam } from 'openai/resources/chat';
import type { ChatCompletionMessageToolCall } from 'openai/resources/chat';
import { logger } from '../services/logger';
import { DEFAULT_SYSTEM_CONTENT } from './prompts';
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
 * Builds the initial message list for the LLM, including system prompts, history summary, and the current user message.
 */
export const buildInitialLlmThread = (
  conversationSummary: string,
  userInfo: UserInfo,
  userMessageText: string,
  botUserId: string,
): ChatMessage[] => {
  const userMessage: ChatCompletionUserMessageParam = { role: 'user', content: userMessageText };

  const llmThread: ChatMessage[] = [
    { role: 'system', content: DEFAULT_SYSTEM_CONTENT },
    {
      role: 'system',
      content: `The current date and time is ${new Date().toISOString()}. Your Slack user ID is <@${botUserId}>.`,
    },
    {
      role: 'system',
      content: `Summary of the immediately preceding conversation (users are referred to by their Slack IDs):\n${conversationSummary}\n`,
    },
    {
      role: 'system',
      content: `The current task is to respond to the most recent user message, in the context of the immediately preceding conversation. The user who left the last message is (details): ${JSON.stringify(userInfo)}. Their most recent message follows.`,
    },
    userMessage,
  ];
  logger.debug({ threadLength: llmThread.length, llmThread }, 'LLM thread prepared');
  return llmThread;
};
