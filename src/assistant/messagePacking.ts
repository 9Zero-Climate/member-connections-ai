/* Utils for packing and unpacking messages between the LLM and Slack */

import type { MessageMetadata } from '@slack/web-api/dist';
import type { FluffyMetadata, MessageElement } from '@slack/web-api/dist/types/response/ConversationsHistoryResponse';
import type { ChatCompletionMessageToolCall } from 'openai/resources/chat/completions';
import type { ChatMessage } from './types';

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
 * Unpack tool call info from a Slack message metadata, if present.
 * this allows us to construct an LLM chat history that includes tool calls that were previously made by the assistant.
 * Without this, the LLM sees a chat thread where it has knowledge without having to make tool calls, and starts hallucinating.
 *
 * @param slackMessage - The Slack message to unpack.
 * @returns LLM chat messages containing the tool call info, or an empty array if no tool call info is present.
 */
export const unpackToolCallSlackMessage = (slackMessage: MessageElement): ChatMessage[] => {
  const metadata = slackMessage.metadata;
  if (isMessageMetadataWithToolCalls(metadata)) {
    const toolCallsPacked = metadata?.event_payload?.tool_calls;
    const toolCallsUnpacked = JSON.parse(toolCallsPacked) as ChatCompletionMessageToolCall[];
    return [
      // This message simulates when the assistant made the tool calls
      {
        role: 'assistant',
        content: null,
        tool_calls: toolCallsUnpacked,
      },
      // This message simulates when the tool calls were completed and sent back to the assistant
      ...getPlaceholderToolCallResponses(toolCallsUnpacked),
    ];
  }
  return [];
};

/**
 * Provided placeholder tool call responses that the assistant expects to see in the chat history after a tool call is made.
 * Since we don't have the actual tool call responses, we include an apologetic message instead.
 *
 * @param toolCalls - The tool calls to create placeholder messages for.
 * @returns A list of tool call messages with placeholder content.
 */
export const getPlaceholderToolCallResponses = (toolCalls: ChatCompletionMessageToolCall[]): ChatMessage[] => {
  return toolCalls.map((toolCall) => ({
    role: 'tool',
    tool_call_id: `${toolCall.id}`,
    content:
      '<This data has been removed as it was not stored in memory. You may repeat the tool call request to refetch the data.>',
  }));
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
 * Convert a Slack message into a list of LLM chat messages.
 * Prepends user messages with their Slack ID for multi-user context.
 * When Slack messages contain tool call metadata, they may result in multiple LLM chat messages.
 *
 * @param slackMessage - The Slack message to convert.
 * @returns The LLM chat messages.
 */
export function convertSlackMessageToLLMMessages(message: MessageElement): ChatMessage[] {
  if (!message.text) {
    return [];
  }

  if (message.bot_id) {
    const messages: ChatMessage[] = [{ role: 'assistant', content: message.text }];
    if (message.metadata?.event_type === 'llm_tool_calls') {
      const toolCallMessages = unpackToolCallSlackMessage(message);
      messages.push(...toolCallMessages);
    }
    return messages;
  }
  // User message: Prepend content with user ID
  return [{ role: 'user', content: `<@${message.user}>: ${message.text}` }];
}

/**
 * Convert Slack message history into a format suitable for using as LLM chat history.
 * @param slackHistory - The Slack message history to convert.
 * @param userSlackMessageTs - The timestamp of the user's message.
 * @returns The LLM chat history.
 */
export function convertSlackHistoryToLLMHistory(
  messages: MessageElement[],
  triggeringMessageTs?: string,
): ChatMessage[] {
  return messages
    .filter((message) => message.text && message.ts !== triggeringMessageTs)
    .flatMap(convertSlackMessageToLLMMessages);
}
