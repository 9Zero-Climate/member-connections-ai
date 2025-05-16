/* Utils for packing and unpacking messages between the LLM and Slack */

import type { MessageMetadata } from '@slack/web-api/dist';
import type { FluffyMetadata, MessageElement } from '@slack/web-api/dist/types/response/ConversationsHistoryResponse';
import type { ChatCompletionMessageToolCall } from 'openai/resources/chat/completions';
import type { ChatMessage } from './types';
// Consider adding: import { logger } from '../services/logger';

type MessageMetadataWithToolCalls = MessageMetadata & {
  event_payload: {
    tool_calls: string; // This is JSON.stringified ChatCompletionMessageToolCall[]
  };
  event_type: 'llm_tool_calls';
};
function isMessageMetadataWithToolCalls(
  metadata: FluffyMetadata | undefined,
): metadata is MessageMetadataWithToolCalls {
  return metadata?.event_type === 'llm_tool_calls';
}

const getCompleteToolCallInfoFromMessage = (message: MessageElement): string | undefined => {
  if (isMessageMetadataWithToolCalls(message.metadata)) {
    return message.metadata.event_payload.tool_calls;
  }
  return undefined;
};

/**
 * Creates a human-and LLM-readable summary of the conversation from Slack messages.
 * @param messages - Array of Slack messages (MessageElement).
 * @param botUserId - The Slack ID of the bot, to identify assistant messages.
 * @returns A string summarizing the conversation.
 */
export const createConversationSummary = (messages: MessageElement[], botUserId?: string): string => {
  if (!messages || messages.length === 0) {
    return 'No prior conversation history.';
  }

  const summaryLines: string[] = [];

  for (const message of messages) {
    const trimmedMessageText = message.text?.trim();
    if (!trimmedMessageText) continue;

    if (message.bot_id && (!botUserId || message.bot_id === botUserId)) {
      const completeToolCallInfo = getCompleteToolCallInfoFromMessage(message);
      if (completeToolCallInfo) {
        summaryLines.push(`  (Assistant used tool(s): ${completeToolCallInfo}.`);
        // Ignore the message text when there are tool calls - it's procedurally generated and not helpful to the assistant
      } else {
        summaryLines.push(`Assistant: ${trimmedMessageText}`);
      }
    } else if (message.user) {
      summaryLines.push(`User <@${message.user}>: ${trimmedMessageText}`);
    }
  }

  if (summaryLines.length === 0) {
    return 'No relevant conversation history to summarize.';
  }

  return summaryLines.join('\n');
};

/**
 * Pack tool call info into Slack message metadata.
 * This metadata is used to record tool calls made by the assistant.
 * @param toolCalls - The LLM tool call info to pack.
 * @returns The Slack message metadata.
 */
export const packToolCallInfoIntoSlackMessageMetadata = (
  toolCalls: ChatCompletionMessageToolCall[],
): MessageMetadataWithToolCalls => ({
  event_type: 'llm_tool_calls',
  event_payload: {
    tool_calls: JSON.stringify(toolCalls),
  },
});
