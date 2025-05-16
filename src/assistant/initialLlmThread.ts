import type { ChatCompletionUserMessageParam } from 'openai/resources/chat';
import type { ChatCompletionMessageToolCall } from 'openai/resources/chat';
import { logger } from '../services/logger';
import { DEFAULT_SYSTEM_CONTENT } from './prompts';
import type { BotIds, UserInfo } from './slackInteraction';
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
  conversationSummary: ChatMessage[],
  userInfo: UserInfo,
  userMessageText: string,
  botIds: BotIds,
): ChatMessage[] => {
  const userMessage: ChatCompletionUserMessageParam = { role: 'user', content: userMessageText };

  const llmThread: ChatMessage[] = [
    { role: 'system', content: DEFAULT_SYSTEM_CONTENT },
    {
      role: 'system',
      content: `The current date and time is ${new Date().toISOString()}. Your Slack bot ID is <@${botIds.botId}> and your Slack user ID is <@${botIds.userId}>.`,
    },
    ...conversationSummary,
    {
      role: 'system',
      content: `The current task is to respond to the most recent user message, in the context of the immediately preceding conversation. Details of the user who left the last message: ${JSON.stringify(userInfo)}. Their most recent message follows.`,
    },
    userMessage,
  ];
  logger.debug({ threadLength: llmThread.length, llmThread }, 'LLM thread prepared');
  return llmThread;
};
