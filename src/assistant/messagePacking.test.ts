import type { MessageElement } from '@slack/web-api/dist/types/response/ConversationsHistoryResponse';
import type { ChatCompletionMessageToolCall } from 'openai/resources/chat/completions';
import {
  convertSlackHistoryToLLMHistory,
  getPlaceholderToolCallResponses,
  packToolCallInfoIntoSlackMessageMetadata,
  unpackToolCallSlackMessage,
} from './messagePacking';

describe('messagePacking', () => {
  describe('getPlaceholderToolCallResponses', () => {
    it('should create placeholder responses for tool calls', () => {
      const toolCalls: ChatCompletionMessageToolCall[] = [
        {
          id: 'call1',
          type: 'function',
          function: {
            name: 'test_function',
            arguments: '{}',
          },
        },
        {
          id: 'call2',
          type: 'function',
          function: {
            name: 'another_function',
            arguments: '{"foo": "bar"}',
          },
        },
      ];

      const result = getPlaceholderToolCallResponses(toolCalls);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        role: 'tool',
        tool_call_id: 'call1',
        content:
          '<This data has been removed as it was not stored in memory. You may repeat the tool call request to refetch the data.>',
      });
      expect(result[1]).toEqual({
        role: 'tool',
        tool_call_id: 'call2',
        content:
          '<This data has been removed as it was not stored in memory. You may repeat the tool call request to refetch the data.>',
      });
    });

    it('should handle empty tool calls array', () => {
      const result = getPlaceholderToolCallResponses([]);
      expect(result).toEqual([]);
    });
  });

  describe('unpackToolCallSlackMessage', () => {
    it('should unpack tool calls from message metadata', () => {
      const toolCalls: ChatCompletionMessageToolCall[] = [
        {
          id: 'call1',
          type: 'function',
          function: {
            name: 'test_function',
            arguments: '{}',
          },
        },
      ];

      const slackMessage: MessageElement = {
        type: 'message',
        text: 'Test message',
        metadata: {
          event_type: 'llm_tool_calls',
          event_payload: {
            tool_calls: JSON.stringify(toolCalls),
          },
        },
      };

      const result = unpackToolCallSlackMessage(slackMessage);
      expect(result).toHaveLength(2); // Assistant message + tool response
      const assistantMessage = result[0];
      if (assistantMessage.role !== 'assistant') {
        throw new Error('Expected assistant message');
      }
      expect(assistantMessage.role).toBe('assistant');
      expect(assistantMessage.tool_calls).toHaveLength(1);
      expect(result[1].role).toBe('tool');
    });

    it('should return empty array for messages without tool call metadata', () => {
      const slackMessage: MessageElement = {
        type: 'message',
        text: 'Test message',
      };

      const result = unpackToolCallSlackMessage(slackMessage);
      expect(result).toEqual([]);
    });
  });

  describe('packToolCallInfoIntoSlackMessageMetadata', () => {
    it('should pack tool calls into message metadata', () => {
      const toolCalls: ChatCompletionMessageToolCall[] = [
        {
          id: 'call1',
          type: 'function',
          function: {
            name: 'test_function',
            arguments: '{}',
          },
        },
      ];

      const result = packToolCallInfoIntoSlackMessageMetadata(toolCalls);
      expect(result.event_type).toBe('llm_tool_calls');
      expect(JSON.parse(result.event_payload.tool_calls)).toEqual(toolCalls);
    });

    it('should handle empty tool calls array', () => {
      const result = packToolCallInfoIntoSlackMessageMetadata([]);
      expect(result.event_type).toBe('llm_tool_calls');
      expect(JSON.parse(result.event_payload.tool_calls)).toEqual([]);
    });
  });

  describe('convertSlackHistoryToLLMHistory', () => {
    it('should convert slack history to LLM chat history', () => {
      const slackHistory: MessageElement[] = [
        {
          type: 'message',
          text: 'User message 1',
          ts: '1234.5678',
        },
        {
          type: 'message',
          text: 'Bot message',
          ts: '1234.5679',
          bot_id: 'B123',
        },
        {
          type: 'message',
          text: 'User message 2',
          ts: '1234.5680',
        },
      ];

      const result = convertSlackHistoryToLLMHistory(slackHistory, '1234.5680');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ role: 'user', content: 'User message 1' });
      expect(result[1]).toEqual({ role: 'assistant', content: 'Bot message' });
    });

    it('should handle messages with tool calls', () => {
      const toolCalls: ChatCompletionMessageToolCall[] = [
        {
          id: 'call1',
          type: 'function',
          function: {
            name: 'test_function',
            arguments: '{}',
          },
        },
      ];

      const slackHistory: MessageElement[] = [
        {
          type: 'message',
          text: 'Bot message with tool calls',
          ts: '1234.5679',
          bot_id: 'B123',
          metadata: {
            event_type: 'llm_tool_calls',
            event_payload: {
              tool_calls: JSON.stringify(toolCalls),
            },
          },
        },
      ];

      const result = convertSlackHistoryToLLMHistory(slackHistory, '1234.5680');
      expect(result).toHaveLength(3); // Bot message + assistant tool calls + tool response
      expect(result[0]).toEqual({ role: 'assistant', content: 'Bot message with tool calls' });

      const assistantToolCallMessage = result[1];
      if (assistantToolCallMessage.role !== 'assistant') {
        throw new Error('Expected assistant message with tool calls');
      }
      expect(assistantToolCallMessage.role).toBe('assistant');
      expect(assistantToolCallMessage.tool_calls).toBeDefined();

      const toolResponseMessage = result[2];
      if (toolResponseMessage.role !== 'tool') {
        throw new Error('Expected tool response message');
      }
      expect(toolResponseMessage.role).toBe('tool');
    });

    it('should skip messages with undefined text', () => {
      // There may be other types of slack messages that don't have any text; ignore those for now
      const slackHistory: MessageElement[] = [
        {
          type: 'message',
          ts: '1234.5678',
        },
        {
          type: 'message',
          text: 'Valid message',
          ts: '1234.5679',
        },
      ];

      const result = convertSlackHistoryToLLMHistory(slackHistory, '1234.5680');
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Valid message');
    });
  });
});
