import { buildInitialLlmThread } from './initialLlmThread';
import { DEFAULT_SYSTEM_CONTENT } from './prompts';
import type { ChatMessage } from './types';

describe('llmHistoryConversion', () => {
  describe('buildInitialLlmThread', () => {
    it('builds initial thread with user info and message', () => {
      const userInfo = {
        slack_ID: '<@U123>',
        preferred_name: 'tester',
        real_name: 'Test User',
        time_zone: 'America/New_York',
        time_zone_offset: -14400,
      };

      const existingHistory: ChatMessage[] = [
        { role: 'system', content: 'Here is the summary of the thread: blah blah blah' },
      ];

      const result = buildInitialLlmThread(existingHistory, userInfo, 'Hello', { botId: 'BOT123', userId: 'USER123' });

      expect(result).toEqual([
        { role: 'system', content: DEFAULT_SYSTEM_CONTENT },
        {
          role: 'system',
          // Should mention both bot and bot user ID so that the assistant can recognize mentions of itself
          content: expect.stringMatching(/^The current date and time is .*BOT123.*USER123.*\.$/),
        },
        { role: 'system', content: 'Here is the summary of the thread: blah blah blah' },
        {
          role: 'system',
          content: `The current task is to respond to the most recent user message, in the context of the immediately preceding conversation. Details of the user who left the last message: ${JSON.stringify(userInfo)}. Their most recent message follows.`,
        },
        { role: 'user', content: 'Hello' },
      ]);
    });
  });
});
