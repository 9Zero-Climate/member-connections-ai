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
 * Converts Slack message history to the LLM chat format.
 * Prepends user messages with their Slack ID for multi-user context.
 */
export const convertSlackHistoryToLLMHistory = (
  slackMessages: SlackMessage[],
  currentUserMessageTs: string,
): ChatMessage[] => {
  // Filter out the current message being processed and sort
  const relevantMessages = slackMessages
    .filter((msg) => msg.ts !== currentUserMessageTs)
    .sort((a, b) => Number.parseFloat(a.ts) - Number.parseFloat(b.ts)); // Ensure chronological order

  const history: ChatMessage[] = [];

  for (const message of relevantMessages) {
    const isBotMessage = message.bot_id !== undefined || message.metadata?.event_type === 'assistant_message';
    const isToolResponseMessage = message.metadata?.event_type === 'tool_result'; // Tool results are posted as bot messages with metadata

    if (isToolResponseMessage && message.metadata?.event_payload?.tool_call_id && message.text) {
      history.push({
        role: 'tool',
        tool_call_id: message.metadata.event_payload.tool_call_id,
        content: message.text,
      });
      // Potentially also add the assistant message that contained the tool *call* if it's stored separately
      // This depends on how packToolCallInfoIntoSlackMessageMetadata works and if the original assistant message text is preserved
      // For now, assuming the originalConvertHistory handled this correctly or it's packed elsewhere.
    } else if (isBotMessage && message.text) {
      // Check if this assistant message contained tool calls
      const toolCalls = message.metadata?.event_payload?.tool_calls;
      if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
        history.push({
          role: 'assistant',
          content: message.text || null, // Content can be null for tool calls
          tool_calls: toolCalls,
        });
      } else {
        // Regular assistant message
        history.push({ role: 'assistant', content: message.text });
      }
    } else if (message.user && message.text) {
      // User message: Prepend with user ID
      history.push({ role: 'user', content: `<@${message.user}>: ${message.text}` });
    }
    // Ignore messages without user/bot ID or text, or subtypes we don't handle
  }
  // Note: The original `convertSlackHistoryToLLMHistory` from messagePacking might need review
  // to ensure it correctly handles the metadata and tool calls/results separation.
  // This implementation makes assumptions based on the provided code.
  // We might need to adjust how botUserId is fetched and passed in.
  logger.debug({ historyLength: history.length }, 'Converted Slack history to LLM format');
  return history;
};

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
