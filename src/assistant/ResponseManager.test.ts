import type { SayFn } from '@slack/bolt';
import type { ChatPostMessageResponse, WebClient } from '@slack/web-api';
import { config } from '../config';
import ResponseManager from './ResponseManager';

jest.mock('../config', () => ({
  config: {
    // This needs to be set but note we're using jest.useFakeTimers() throughout these tests so the value shouldn't matter
    chatEditIntervalMs: 100,
  },
}));

// Define a type for our specific mock needs to avoid 'any'
type MockChatPostMessageResponse = Partial<ChatPostMessageResponse> & {
  ok: true;
  channel: string;
  ts: string;
  message?: { text?: string };
};

describe('ResponseManager', () => {
  let mockClient: { chat: { update: jest.Mock } };
  let mockSay: jest.MockedFunction<SayFn>;
  let responseManager: ResponseManager;
  const testChannel = 'C123CHANNEL';
  const testTs = '1678886400.000001';
  const placeholderText = '_thinking..._';

  beforeEach(() => {
    jest.useFakeTimers();
    mockClient = {
      chat: {
        update: jest.fn(),
      },
    };
    mockSay = jest.fn();

    responseManager = new ResponseManager({
      client: mockClient as unknown as WebClient,
      say: mockSay,
    });

    // Default successful mock response for say()
    mockSay.mockResolvedValue({
      ok: true,
      channel: testChannel,
      ts: testTs,
      message: { text: placeholderText },
    } as MockChatPostMessageResponse);

    // Default successful mock response for update()
    mockClient.chat.update.mockResolvedValue({
      ok: true,
      channel: testChannel,
      ts: testTs,
      message: { text: expect.any(String) }, // Text will vary
    } as MockChatPostMessageResponse);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('startNewMessageWithPlaceholder', () => {
    it('should call say with the placeholder and store message details', async () => {
      await responseManager.startNewMessageWithPlaceholder(placeholderText);
      expect(mockSay).toHaveBeenCalledWith({ text: placeholderText });
      expect(mockSay).toHaveBeenCalledTimes(1);
      expect(mockClient.chat.update).not.toHaveBeenCalled();
    });

    it('should throw an error if called while a message is already in progress', async () => {
      await responseManager.startNewMessageWithPlaceholder('first placeholder');
      await expect(responseManager.startNewMessageWithPlaceholder('second placeholder')).rejects.toThrow(
        'Cannot start a new message while there is an in-progress message.',
      );
    });
  });

  describe('appendToMessage', () => {
    beforeEach(async () => {
      // Start a message for append tests
      await responseManager.startNewMessageWithPlaceholder(placeholderText);
    });

    it('should not call update if appended text is too short', async () => {
      await responseManager.appendToMessage('short');
      jest.advanceTimersByTime(config.chatEditIntervalMs + 1);
      // await responseManager.appendToMessage(''); // No need to trigger explicitly
      // Run timers to ensure any potential delayed update is flushed (or not)
      jest.runOnlyPendingTimers();
      expect(mockClient.chat.update).not.toHaveBeenCalled();
    });

    it('should not call update if cooldown period has not passed', async () => {
      // Initialize lastUpdateTime via startNewMessage in beforeEach
      // jest.advanceTimersByTime(1); // Ensure Date.now() is non-zero for start - Handled by beforeEach timer setup
      // await responseManager.startNewMessageWithPlaceholder(placeholderText); // Already called in beforeEach
      const startTime = Date.now(); // Record start time after beforeEach completes

      await responseManager.appendToMessage('This is long enough');
      // Update should NOT be called here as cooldown hasn't passed since start
      expect(mockClient.chat.update).not.toHaveBeenCalled();

      // Advance time, but not enough for cooldown relative to startTime
      jest.advanceTimersByTime(config.chatEditIntervalMs - (Date.now() - startTime) - 1); // Advance up to 1ms before cooldown ends
      await responseManager.appendToMessage('.'); // Append more
      expect(mockClient.chat.update).not.toHaveBeenCalled(); // Still shouldn't be called

      // Advance past cooldown
      jest.advanceTimersByTime(2);
      await responseManager.appendToMessage('!'); // Append more to trigger check

      // NOW it should be called
      expect(mockClient.chat.update).toHaveBeenCalledTimes(1);
      expect(mockClient.chat.update).toHaveBeenCalledWith(expect.objectContaining({ text: 'This is long enough.!' }));
    });

    it('should call update when text is long enough and cooldown has passed', async () => {
      const longText = 'This is definitely long enough to trigger an update.';
      // Advance time ensure cooldown from start is passed
      jest.advanceTimersByTime(config.chatEditIntervalMs + 1);
      await responseManager.appendToMessage(longText);

      // Update should have been called as time & length criteria are met
      expect(mockClient.chat.update).toHaveBeenCalledWith({
        channel: testChannel,
        ts: testTs,
        text: longText, // Should be just the long text
      });
      expect(mockClient.chat.update).toHaveBeenCalledTimes(1);
    });

    it('should only call update once after cooldown for rapid appends', async () => {
      const part1 = 'Part 1, long enough. ';
      const part2 = 'Part 2. ';
      const part3 = 'Part 3.';
      const fullText = part1 + part2 + part3;

      // Make appends within the cooldown interval
      await responseManager.appendToMessage(part1);
      expect(mockClient.chat.update).not.toHaveBeenCalled(); // Too soon
      jest.advanceTimersByTime(config.chatEditIntervalMs / 3);
      await responseManager.appendToMessage(part2);
      expect(mockClient.chat.update).not.toHaveBeenCalled(); // Still too soon
      jest.advanceTimersByTime(config.chatEditIntervalMs / 3);
      await responseManager.appendToMessage(part3);
      expect(mockClient.chat.update).not.toHaveBeenCalled(); // Still too soon

      // Advance time past the initial cooldown relative to message start
      jest.advanceTimersByTime(config.chatEditIntervalMs + 1);
      await responseManager.appendToMessage('!'); // Trigger check

      expect(mockClient.chat.update).toHaveBeenCalledWith({
        channel: testChannel,
        ts: testTs,
        text: `${fullText}!`, // Should contain all parts + trigger
      });
      expect(mockClient.chat.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('finalizeMessage', () => {
    beforeEach(async () => {
      // Start a message for finalize tests
      await responseManager.startNewMessageWithPlaceholder(placeholderText);
    });

    it('should call update with the final text and return it', async () => {
      const finalContent = 'This is the complete final message.';
      await responseManager.appendToMessage(finalContent);

      const finalizePromise = responseManager.finalizeMessage();
      // Run timers needed by finalizeMessage (potential cooldown)
      jest.runAllTimers();
      const returnedText = await finalizePromise;

      expect(returnedText).toBe(finalContent);
      expect(mockClient.chat.update).toHaveBeenCalledWith({
        channel: testChannel,
        ts: testTs,
        text: finalContent,
      });
      // Update might be called by appendToMessage if conditions met, *and* by finalize.
      // Let's check it was called at least once with the final content.
      expect(mockClient.chat.update).toHaveBeenCalled();
    });

    it('should wait for cooldown before final update if needed', async () => {
      const longText = 'A long message that could trigger an update.';
      // Advance time past cooldown to allow potential first update
      jest.advanceTimersByTime(config.chatEditIntervalMs + 1);
      await responseManager.appendToMessage(longText);
      // Check if the first update happened (it should have)
      expect(mockClient.chat.update).toHaveBeenCalledTimes(1);
      const timeOfFirstUpdate = Date.now();
      mockClient.chat.update.mockClear(); // Reset mock for finalize check

      // Append more text shortly after (within cooldown of first update)
      const additionalText = ' More text added later.';
      jest.advanceTimersByTime(10);
      await responseManager.appendToMessage(additionalText);
      expect(mockClient.chat.update).not.toHaveBeenCalled(); // Should not update yet

      const finalizePromise = responseManager.finalizeMessage();
      // Should not have updated yet
      expect(mockClient.chat.update).not.toHaveBeenCalled();

      // Advance time to complete cooldown *relative to the first update*
      const timeToAdvance = config.chatEditIntervalMs - (Date.now() - timeOfFirstUpdate) + 1;
      if (timeToAdvance > 0) {
        jest.advanceTimersByTime(timeToAdvance);
      }
      // also run any remaining timers set by finalize itself
      jest.runOnlyPendingTimers();

      const returnedText = await finalizePromise;
      const expectedFinalText = `${longText}${additionalText}`;

      expect(returnedText).toBe(expectedFinalText);
      expect(mockClient.chat.update).toHaveBeenCalledWith({
        channel: testChannel,
        ts: testTs,
        text: expectedFinalText,
      });
      expect(mockClient.chat.update).toHaveBeenCalledTimes(1);
    });

    it('should reset state, allowing a new message to start', async () => {
      await responseManager.appendToMessage('Some content');
      const finalizePromise = responseManager.finalizeMessage();
      jest.runAllTimers(); // Run timers for finalize
      await finalizePromise;

      // Should be able to start a new message now. If it throws, the test fails.
      await responseManager.startNewMessageWithPlaceholder('New placeholder');
      // await expect(responseManager.startNewMessageWithPlaceholder('New placeholder')).resolves.toBeDefined(); // Incorrect assertion for Promise<void>
      expect(mockSay).toHaveBeenCalledTimes(2); // Original + new
    });
  });

  describe('Error Handling', () => {
    it('should reject finalize if initial say response lacked channel', async () => {
      // Override default mock for this test
      mockSay.mockResolvedValueOnce({
        ok: true,
        ts: testTs, // Has ts, missing channel
        // biome-ignore lint/suspicious/noExplicitAny: Intentionally creating invalid mock
      } as any); // Using 'any' as we are intentionally creating an invalid state

      await responseManager.startNewMessageWithPlaceholder(placeholderText);
      await responseManager.appendToMessage('Some text long enough');
      // Advance timers PAST cooldown, appendToMessage should NOT have thrown
      jest.advanceTimersByTime(config.chatEditIntervalMs + 1);
      expect(mockClient.chat.update).not.toHaveBeenCalled(); // Should not have updated due to invalid state

      // Finalize *will* attempt the update and fail
      const finalizePromise = responseManager.finalizeMessage();
      jest.runAllTimers(); // Ensure finalize cooldown completes
      await expect(finalizePromise).rejects.toThrow(/Failed to get timestamp or channel/i);
    });

    it('should reject finalize if initial say response lacked timestamp', async () => {
      // Override default mock for this test
      mockSay.mockResolvedValueOnce({
        ok: true,
        channel: testChannel, // Has channel, missing ts
        // biome-ignore lint/suspicious/noExplicitAny: Intentionally creating invalid mock
      } as any); // Using 'any' as we are intentionally creating an invalid state

      await responseManager.startNewMessageWithPlaceholder(placeholderText);
      await responseManager.appendToMessage('Some text long enough');
      // Advance timers PAST cooldown, appendToMessage should NOT have thrown
      jest.advanceTimersByTime(config.chatEditIntervalMs + 1);
      expect(mockClient.chat.update).not.toHaveBeenCalled(); // Should not have updated due to invalid state

      // Finalize *will* attempt the update and fail
      const finalizePromise = responseManager.finalizeMessage();
      jest.runAllTimers(); // Ensure finalize cooldown completes
      await expect(finalizePromise).rejects.toThrow(/Failed to get timestamp or channel/i);
    });
  });
});
