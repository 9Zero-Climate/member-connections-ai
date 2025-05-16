import type { MessageElement } from '@slack/web-api/dist/types/response/ConversationsHistoryResponse';
import type { ChatCompletionMessageToolCall } from 'openai/resources/chat/completions';
import { convertSlackHistoryForLLMContext, packToolCallInfoIntoSlackMessageMetadata } from './messagePacking';

describe('messagePacking', () => {
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
          user: 'U123',
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
          user: 'U123',
        },
      ];

      const result = convertSlackHistoryForLLMContext(slackHistory, 'B123');
      expect(result).toHaveLength(1); // Now returns a single system message
      expect(result[0].role).toBe('system');
      expect(result[0].content).toContain('User <@U123>: User message 1');
      expect(result[0].content).toContain('Assistant: Bot message');
      expect(result[0].content).toContain('User <@U123>: User message 2');
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

      const result = convertSlackHistoryForLLMContext(slackHistory, 'B123');
      expect(result).toHaveLength(1); // Now returns a single system message
      expect(result[0].role).toBe('system');
      expect(result[0].content).toContain('Assistant used tool(s):');
      expect(result[0].content).toContain('test_function');
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
          user: 'U123',
          ts: '1234.5679',
        },
      ];

      const result = convertSlackHistoryForLLMContext(slackHistory, 'B123');
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('system');
      expect(result[0].content).toContain('User <@U123>: Valid message');
      // Check that it doesn't include anything for the message with no text
      expect(result[0].content).not.toContain('undefined');
      expect(result[0].content).not.toContain('null');
    });
  });
});
