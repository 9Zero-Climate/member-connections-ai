/* Utils for packing and unpacking messages between the LLM and Slack */

import { randomUUID } from 'node:crypto';
import type { MessageMetadata } from '@slack/web-api/dist';
import type { FluffyMetadata, MessageElement } from '@slack/web-api/dist/types/response/ConversationsHistoryResponse';
import type { ChatCompletionMessageToolCall } from 'openai/resources/chat/completions';
import type { ChatMessage } from '.';
import { logger } from '../services/logger';

export const getPlaceholderToolCallResponses = (toolCalls: ChatCompletionMessageToolCall[]): ChatMessage[] => {
  return toolCalls.map((toolCall) => ({
    role: 'tool',
    tool_call_id: `${toolCall.id}`,
    content:
      '<This data has been removed as it was not stored in memory. You may repeat the tool call request to refetch the data.>',
  }));
};

type MessageMetadataWithToolCalls = MessageMetadata & {
  event_payload: {
    tool_calls: string;
  };
  event_type: 'llm_tool_calls';
};
function isMessageMetadataWithToolCalls(
  metadata: FluffyMetadata | undefined,
): metadata is MessageMetadataWithToolCalls {
  return metadata?.event_type === 'llm_tool_calls';
}

/**
 * Unpacks tool call info from a Slack message metadata, if present.
 * @param slackMessage - The Slack message to unpack.
 * @returns LLM chat messages containing the tool call info, or an empty array if no tool call info is present.
 */
export const unpackToolCallSlackMessage = (slackMessage: MessageElement): ChatMessage[] => {
  const metadata = slackMessage.metadata;
  if (isMessageMetadataWithToolCalls(metadata)) {
    const toolCallsPacked = metadata?.event_payload?.tool_calls;
    const toolCallsUnpacked = JSON.parse(toolCallsPacked) as ChatCompletionMessageToolCall[];
    return [
      {
        role: 'assistant',
        tool_calls: toolCallsUnpacked,
      },
      ...getPlaceholderToolCallResponses(toolCallsUnpacked),
    ];
  }
  return [];
};

/**
 * Pack tool call info into Slack message metadata.
 * This metadata will later be unpacked by {@link unpackToolCallSlackMessage}.
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

/**
 * Convert Slack message history into a format suitable for using as LLM chat history.
 * @param slackHistory - The Slack message history to convert.
 * @param userSlackMessageTs - The timestamp of the user's message.
 * @returns The LLM chat history.
 */
export const convertSlackHistoryToLLMHistory = (
  slackHistory: MessageElement[],
  userSlackMessageTs: string,
): ChatMessage[] => {
  return slackHistory
    .filter((m) => m?.ts !== userSlackMessageTs && typeof m?.text === 'string')
    .flatMap((m): ChatMessage[] => {
      const role = m?.bot_id ? 'assistant' : 'user';

      const normalMessages = m?.text ? [{ role, content: m?.text } as ChatMessage] : [];
      const toolCallsMessages = unpackToolCallSlackMessage(m);
      return [...normalMessages, ...toolCallsMessages];
    });
};
