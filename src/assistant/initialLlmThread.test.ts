import { buildInitialLlmThread } from './initialLlmThread';
import { DEFAULT_SYSTEM_CONTENT } from './prompts';
import type { ChatMessage } from './types';

describe('llmHistoryConversion', () => {
  describe('buildInitialLlmThread', () => {
    it('should build initial thread with user info and message', () => {
      const userInfo = {
        slack_ID: '<@U123>',
        preferred_name: 'tester',
        real_name: 'Test User',
        time_zone: 'America/New_York',
        time_zone_offset: -14400,
      };

      const existingHistory: ChatMessage[] = [
        { role: 'user', content: 'Previous message' },
        { role: 'assistant', content: 'Previous response' },
      ];

      const result = buildInitialLlmThread(existingHistory, userInfo, 'Hello', 'BOT123');

      // Extract just the date from the result for stable test comparison
      const dateTimeMessage = result[1].content as string;
      expect(dateTimeMessage).toMatch(/^The current date and time is .* and your slack ID is BOT123\.$/);

      expect(result).toEqual([
        { role: 'system', content: DEFAULT_SYSTEM_CONTENT },
        {
          role: 'system',
          content: expect.stringMatching(/^The current date and time is .* and your slack ID is BOT123\.$/),
        },
        { role: 'system', content: 'Here is the conversation history (if any):' },
        { role: 'user', content: 'Previous message' },
        { role: 'assistant', content: 'Previous response' },
        { role: 'system', content: `The following message is from: ${JSON.stringify(userInfo)}` },
        { role: 'user', content: 'Hello' },
      ]);
    });

    it('should handle empty history', () => {
      const userInfo = {
        slack_ID: '<@U123>',
        preferred_name: 'tester',
        real_name: 'Test User',
        time_zone: 'America/New_York',
        time_zone_offset: -14400,
      };

      const result = buildInitialLlmThread([], userInfo, 'Hello', 'BOT123');

      expect(result).toEqual([
        { role: 'system', content: DEFAULT_SYSTEM_CONTENT },
        {
          role: 'system',
          content: expect.stringMatching(/^The current date and time is .* and your slack ID is BOT123\.$/),
        },
        { role: 'system', content: 'Here is the conversation history (if any):' },
        { role: 'system', content: `The following message is from: ${JSON.stringify(userInfo)}` },
        { role: 'user', content: 'Hello' },
      ]);
    });
  });
});
