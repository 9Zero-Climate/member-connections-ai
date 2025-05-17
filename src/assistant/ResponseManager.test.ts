import type { SayFn } from '@slack/bolt';
import type { ChatPostMessageResponse, WebClient } from '@slack/web-api';
import { config } from '../config';
import { logger } from '../services/logger';
import ResponseManager, { splitMessageThatIsTooLong, findNewlineIndexToSplitMessage } from './ResponseManager';

jest.mock('../config', () => ({
  config: {
    // This needs to be set but note we're using jest.useFakeTimers() throughout these tests so the value shouldn't matter
    chatEditIntervalMs: 100,
  },
}));

jest.mock('../services/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
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
  const SLACK_MAX_MESSAGE_LENGTH = 3000; // Value from ResponseManager.ts

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
      channelOrThreadTs: testTs,
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
    (logger.warn as jest.Mock).mockClear();
    (logger.info as jest.Mock).mockClear();
    (logger.error as jest.Mock).mockClear();
    (logger.debug as jest.Mock).mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('startNewMessageWithPlaceholder', () => {
    it('should call say with the placeholder and store message details', async () => {
      await responseManager.startNewMessageWithPlaceholder(placeholderText);
      expect(mockSay).toHaveBeenCalledWith({ text: placeholderText, thread_ts: '1678886400.000001' });
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

    it('should call update with the final text and return text, and ts', async () => {
      const finalContent = 'This is the complete final message.';
      await responseManager.appendToMessage(finalContent);

      const finalizePromise = responseManager.finalizeMessage();
      // Run timers needed by finalizeMessage (potential cooldown)
      jest.runAllTimers();
      const returnedResult = await finalizePromise;

      expect(returnedResult.text).toBe(finalContent);
      expect(returnedResult.ts).toBe(testTs);
      expect(mockClient.chat.update).toHaveBeenCalledWith({
        channel: testChannel,
        ts: testTs,
        text: finalContent,
      });
      expect(mockClient.chat.update).toHaveBeenCalled();
    });

    it('should wait for cooldown before final update if needed and return details', async () => {
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

      const returnedResult = await finalizePromise;
      const expectedFinalText = `${longText}${additionalText}`;

      expect(returnedResult.text).toBe(expectedFinalText);
      expect(returnedResult.ts).toBe(testTs);
      expect(returnedResult.channel).toBe(testChannel);
      expect(mockClient.chat.update).toHaveBeenCalledWith({
        channel: testChannel,
        ts: testTs,
        text: expectedFinalText,
      });
      expect(mockClient.chat.update).toHaveBeenCalledTimes(1);
    });

    it('should return final details even if no text was appended (placeholder case)', async () => {
      // No appendToMessage called, only the placeholder was shown
      const finalizePromise = responseManager.finalizeMessage();
      jest.runAllTimers();
      const returnedResult = await finalizePromise;

      expect(returnedResult.text).toBe(''); // No text content
      expect(returnedResult.ts).toBe(testTs); // Should still have ts of the placeholder
      expect(mockClient.chat.update).not.toHaveBeenCalled(); // No update needed for empty content
    });

    it('should return undefined ts/channel if update fails during finalization', async () => {
      const errorText = 'Slack API Error!';
      mockClient.chat.update.mockRejectedValueOnce(new Error(errorText));

      await responseManager.appendToMessage('Some content');
      const finalizePromise = responseManager.finalizeMessage();
      jest.runAllTimers();
      const returnedResult = await finalizePromise;

      // finalizeMessage itself shouldn't throw here, but log the error and return blank ts/channel
      expect(returnedResult.text).toBe('Some content');
      expect(returnedResult.ts).toBeUndefined();
      expect(mockClient.chat.update).toHaveBeenCalledTimes(1); // It was attempted
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

  describe('updateMessage', () => {
    beforeEach(async () => {
      // Start a message for these tests
      await responseManager.startNewMessageWithPlaceholder(placeholderText);
      // Ensure mockSay is reset if it was used by startNewMessageWithPlaceholder
      mockSay.mockClear();
      // Reset update mock as well for clean checks in each updateMessage test
      mockClient.chat.update.mockClear();
    });

    it('should call update directly if message is shorter than SLACK_MAX_MESSAGE_LENGTH', async () => {
      const shortMessage = 'This is a short message.';
      // currentResponseText is updated internally by appendToMessage
      // We'll call appendToMessage then trigger updateMessage logic by advancing timers
      await responseManager.appendToMessage(shortMessage);
      jest.advanceTimersByTime(config.chatEditIntervalMs + 1);
      await responseManager.appendToMessage(''); // Trigger update check

      expect(mockClient.chat.update).toHaveBeenCalledTimes(1);
      expect(mockClient.chat.update).toHaveBeenCalledWith({
        channel: testChannel,
        ts: testTs,
        text: shortMessage,
      });
    });

    it('posts split message as 2 messages when message exceeds SLACK_MAX_MESSAGE_LENGTH', async () => {
      // 1. Arrange
      const initialMessageTs = testTs; // testTs is the TS from the initial placeholder message
      const tsAfterFirstPrefixUpdate = 'ts.after.first.prefix.update';
      const tsAfterSecondPrefixUpdate = 'ts.after.second.prefix.update'; // From finalizeMessage's internal update
      const continuedMessageTs = 'ts.continued.message';

      const part1 =
        'This is the first part of a very long message, long enough to ensure it gets split. It contains newlines.\n';
      const part2 =
        'This is the second part, which will become the suffix after the split occurs because the total length is greater than SLACK_MAX_MESSAGE_LENGTH. More text to make it long.\nEven more text.';
      const longMessage = part1 + 'a'.repeat(SLACK_MAX_MESSAGE_LENGTH) + part2;

      // Determine actual prefix and suffix based on real function's behavior
      const actualSplit = splitMessageThatIsTooLong(longMessage, SLACK_MAX_MESSAGE_LENGTH);
      const expectedPrefix = actualSplit.prefix;
      const expectedSuffix = actualSplit.suffix;

      // Ensure the split will actually happen and produce a non-empty prefix and suffix for this test
      expect(expectedPrefix).not.toBe(longMessage);
      expect(expectedSuffix).not.toBe('');
      expect(expectedPrefix.length).toBeLessThanOrEqual(SLACK_MAX_MESSAGE_LENGTH);

      // Mock setup for chat.update:
      // 1st call: during initial split, updates original message with prefix
      mockClient.chat.update.mockResolvedValueOnce({
        ok: true,
        channel: testChannel,
        ts: tsAfterFirstPrefixUpdate, // Returns new TS
        message: { text: expectedPrefix },
      } as MockChatPostMessageResponse);
      // 2nd call: from finalizeMessage's internal call to updateMessage (still with prefix)
      mockClient.chat.update.mockResolvedValueOnce({
        ok: true,
        channel: testChannel,
        ts: tsAfterSecondPrefixUpdate, // Returns another new TS
        message: { text: expectedPrefix },
      } as MockChatPostMessageResponse);

      // Mock setup for say (for the new "continued" message)
      mockSay.mockResolvedValueOnce({
        ok: true,
        channel: testChannel,
        ts: continuedMessageTs,
        message: { text: '_takes deep breath_' },
      } as MockChatPostMessageResponse);

      // 2. Act
      // Directly set currentResponseText and call updateMessage for focused testing of the split logic.
      // The startNewMessageWithPlaceholder in beforeEach already set up an inProgressMessage.
      // @ts-expect-error Test wants to access private member
      responseManager.currentResponseText = longMessage;
      // @ts-expect-error Test wants to access private member
      const updatePromise = responseManager.updateMessage();

      // Advance time past the cooldown period
      jest.advanceTimersByTime(config.chatEditIntervalMs + 1);
      // Run any pending timers
      jest.runOnlyPendingTimers();

      await updatePromise;

      // 3. Assert
      // First update call (prefix to original message)
      expect(mockClient.chat.update).toHaveBeenNthCalledWith(1, {
        channel: testChannel,
        ts: initialMessageTs, // Original TS of the placeholder message
        text: expectedPrefix,
      });

      // Second update call (prefix again, from finalizeMessage, using TS from first update)
      expect(mockClient.chat.update).toHaveBeenNthCalledWith(2, {
        channel: testChannel,
        ts: tsAfterFirstPrefixUpdate, // TS returned by the first update
        text: expectedPrefix,
      });

      // Say call for the new "continued" message
      expect(mockSay).toHaveBeenCalledWith({
        text: '_takes deep breath_',
        thread_ts: initialMessageTs, // Should be in the same thread as the original placeholder
      });

      // Check internal state after operations
      // @ts-expect-error Test wants to access private member
      expect(responseManager.currentResponseText).toBe(expectedSuffix);
      // @ts-expect-error Test wants to access private member
      expect(responseManager.inProgressMessage?.ts).toBe(continuedMessageTs);

      // Verify total calls
      expect(mockClient.chat.update).toHaveBeenCalledTimes(2);
      expect(mockSay).toHaveBeenCalledTimes(1);
    });
  });
});

describe('splitMessageThatIsTooLong', () => {
  it('splits a message correctly when a valid newline index is found', () => {
    const message = '11111\n22222'; // Total length 11, newline at index 5
    // For limit = 7, findNewlineIndexToSplitMessage should return 5.
    const result = splitMessageThatIsTooLong(message, 7);
    expect(result).toEqual({ prefix: '11111', suffix: '22222' });
  });

  it('returns the original message as prefix and empty suffix when no suitable newline is found', () => {
    const message = '111112222233333'; // No newlines, length 15
    // For limit = 10, findNewlineIndexToSplitMessage should return null.
    const result = splitMessageThatIsTooLong(message, 10);
    expect(result).toEqual({ prefix: message, suffix: '' });
    // logger.warn would be called internally by splitMessageThatIsTooLong in this case.
  });

  it('handles an empty message string', () => {
    const message = '';
    // findNewlineIndexToSplitMessage("", 10) would return null.
    const result = splitMessageThatIsTooLong(message, 10);
    expect(result).toEqual({ prefix: '', suffix: '' });
  });
});

describe('findNewlineIndexToSplitMessage', () => {
  it.each([
    // Basic cases
    { message: '12345\n78901', limit: 10, expectedIndex: 5, description: "'12345\n78901'; lim 10 (nl before lim)" },
    { message: '12345\n78901', limit: 3, expectedIndex: 5, description: "'12345\n78901'; lim 3 (nl after lim)" },
    { message: '1234567890', limit: 10, expectedIndex: null, description: "'1234567890' no nl; lim 10" },
    { message: '1\n234567890', limit: 10, expectedIndex: 1, description: "'1\n234567890'; lim 10 (nl at start)" },
    {
      message: '1234567890\n',
      limit: 10,
      expectedIndex: 10,
      description: "'1234567890\n'; lim 10 (nl after lim, picked)",
    },
    { message: '1234567890\n', limit: 11, expectedIndex: 10, description: "'1234567890\n'; lim 11 (nl included)" },
    {
      message: '1\n34\n678\n0123',
      limit: 3,
      expectedIndex: 1,
      description: "'1\n34\n678\n0123'; lim 3 (in '34'). Prefers last nl before lim ('1\n')",
    },
    {
      message: '1\n34\n678\n0123',
      limit: 0,
      expectedIndex: 1,
      description: "'1\n34\n678\n0123'; lim 0. Prefers first nl after lim ('1\n')",
    },

    // Edge cases for limit
    { message: '12345\n78901', limit: 5, expectedIndex: 5, description: "'12345\n78901'; lim 5 (lim at nl)" },
    { message: '12345\n78901', limit: 0, expectedIndex: 5, description: "'12345\n78901'; lim 0 (nl exists after)" },

    // Edge cases for message
    { message: '', limit: 10, expectedIndex: null, description: 'empty string; lim 10' },
    { message: '\n', limit: 0, expectedIndex: null, description: 'do not use newline in position 0' },
    { message: ' \n', limit: 0, expectedIndex: 1, description: 'allow newline in position 1' },
    { message: '123', limit: 0, expectedIndex: null, description: "'123' no nl; lim 0" },
    { message: '123', limit: 10, expectedIndex: null, description: "'123' no nl; lim 10" },

    // Specific logic: canUseEarlyNewline (lastNewlineIndex > 0) vs canUseLaterNewline (firstNewlineAfterLimitIndex > 0)
    {
      message: '123\n567\n901',
      limit: 8,
      expectedIndex: 7,
      description: "'123\n567\n901'; lim 8. Prefers last nl >0 before lim ('567\n' at 7)",
    },
    {
      message: '123\n567\n901',
      limit: 7,
      expectedIndex: 7,
      description: "'123\n567\n901'; lim 7. last nl is at 7. (7>0) is true.",
    },
    {
      message: '1\n34\n678',
      limit: 3,
      expectedIndex: 1,
      description: "'1\n34\n678'; lim 3. last nl ('1\n' at 1) is >0 and before lim. (1>0) is true.",
    },

    // canUseEarlyNewline is false (lastNewlineIndex <= 0), check canUseLaterNewline
    {
      message: '123\n56789',
      limit: 2,
      expectedIndex: 3,
      description: "'123\n56789'; lim 2. no nl before/at lim 2. Picks first after ('123\n' at 3).",
    },
    {
      message: '\n123456789',
      limit: 0,
      expectedIndex: null,
      description: "'\n123456789'; lim 0. lastInd(0)=0(not>0). firstInd(0)=0(not>0). Null.",
    },
    {
      message: '123456\n890',
      limit: 0,
      expectedIndex: 6,
      description: "'123456\n890'; lim 0. no nl before/at lim 0. Picks first after ('123456\n' at 6).",
    },
    {
      message: '123456\n890',
      limit: 6,
      expectedIndex: 6,
      description: "'123456\n890'; lim 6. no nl before lim 6. Picks first AT/after ('123456\n' at 6).",
    },

    // Both canUseEarlyNewline and canUseLaterNewline are false
    { message: '123456789', limit: 10, expectedIndex: null, description: "'123456789' no nl; lim 10" },
    { message: '123456789', limit: 0, expectedIndex: null, description: "'123456789' no nl; lim 0" },
    {
      message: '\n',
      limit: -1,
      expectedIndex: null,
      description: 'only nl at 0. lim -1 (becomes 0). lastInd(0)=0(not>0). firstInd(0)=0(not>0). Null.',
    },
  ])('for message "$message" and limit $limit, returns $expectedIndex ($description)', (testCaseObject) => {
    const { message, limit, expectedIndex } = testCaseObject;
    expect(findNewlineIndexToSplitMessage(message, limit)).toBe(expectedIndex);
  });
});
