/* Utils for packing and unpacking messages between the LLM and Slack */

import type { MessageMetadata } from '@slack/web-api/dist';
import type { FluffyMetadata, MessageElement } from '@slack/web-api/dist/types/response/ConversationsHistoryResponse';
import type { ChatCompletionMessageToolCall } from 'openai/resources/chat/completions';
import type { ChatMessage } from './types';

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

export const NO_CONVERSATION_HISTORY_SUMMARY = '[No history in this thread. This is a brand new conversation.]';

export const stringifySlackMessage = (message: MessageElement, botUserId: string): string => {
  const trimmedMessageText = message.text?.trim();
  if (!trimmedMessageText) return '';

  if (message.bot_id && message.bot_id === botUserId) {
    const completeToolCallInfo = getCompleteToolCallInfoFromMessage(message);
    if (completeToolCallInfo) {
      return `  (Assistant used tool(s): ${completeToolCallInfo}.)`;
      // Ignore the message text when there are tool calls - it's procedurally generated and not helpful to the assistant
    }
    return `Assistant: ${trimmedMessageText}`;
  }
  return `User <@${message.user}>: ${trimmedMessageText}`;
};

/**
 * Convert Slack message history into a human- and LLM-readable
 */
export function stringifySlackConversation(messages: MessageElement[], botUserId: string): string {
  const conversationLines = messages.map((message) => stringifySlackMessage(message, botUserId));

  return conversationLines ? conversationLines.join('\n') : NO_CONVERSATION_HISTORY_SUMMARY;
}

export const convertSlackHistoryForLLMContext = (messages: MessageElement[], botUserId: string): ChatMessage[] => {
  const conversationString = stringifySlackConversation(messages, botUserId);
  return [
    {
      role: 'system',
      content: `Summary of the preceding conversation (users are referred to by their Slack IDs):\n${conversationString}`,
    },
  ];
};
