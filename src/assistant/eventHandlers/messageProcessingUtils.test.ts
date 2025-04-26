import { WebClient } from '@slack/web-api';
import { OpenAI } from 'openai';
import type { ChatMessage } from '..';
import { config } from '../../config'; // Import the mocked config
import { logger } from '../../services/logger';
// import { vi } from 'vitest'; // Removed vitest
import ResponseManager from '../ResponseManager';
import { DEFAULT_SYSTEM_CONTENT } from '../constants';
import executeToolCalls from '../executeToolCalls';
import {
  type HandleIncomingMessageArgs, // Import the args type
  // Assuming getBotUserId is not exported, test it via handleIncomingMessage
  type SlackMessage,
  type UserInfo,
  addFeedbackHintReactions,
  buildInitialLlmThread,
  convertSlackHistoryToLLMHistory,
  fetchSlackThread,
  fetchUserInfo,
  handleIncomingMessage,
  runLlmConversation,
} from './messageProcessingUtils';

// --- Mock Implementations ---
const mockReplies = jest.fn();
const mockInfo = jest.fn();
const mockAuthTest = jest.fn();
const mockReactionsAdd = jest.fn();
const mockReactionsRemove = jest.fn();
const mockPostMessage = jest.fn();
// const mockCompletionsCreate = jest.fn(); // Define inside factory

// --- Mock Factories ---
jest.mock('@slack/web-api', () => ({
  WebClient: jest.fn().mockImplementation(() => ({
    conversations: { replies: mockReplies },
    users: { info: mockInfo },
    auth: { test: mockAuthTest },
    reactions: { add: mockReactionsAdd, remove: mockReactionsRemove },
    chat: { postMessage: mockPostMessage },
    // Add any other methods/properties needed by the code under test
  })),
}));

// Define the mock function here, potentially needed by the factory itself
// const mockCompletionsCreate = jest.fn(); // Removed - defined inline below

jest.mock('openai', () => ({
  OpenAI: jest.fn().mockImplementation(() => ({
    // Define the mock function directly inside the factory
    chat: {
      completions: {
        create: jest.fn(), // Use jest.fn() directly
      },
    },
    // Add other methods/properties if needed
  })),
}));

// We also need to export the mock function from the test file itself for require to work
// export { mockCompletionsCreate }; // Removed export

jest.mock('../ResponseManager');
jest.mock('../executeToolCalls');
jest.mock('../../services/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));
jest.mock('../../config', () => ({
  config: {
    modelName: 'test-model',
    maxToolCallIterations: 5,
    // Add other necessary config values if needed by the functions
  },
}));

// Get mock instances type safely
const MockedWebClient = WebClient as jest.MockedClass<typeof WebClient>;
const MockedOpenAI = OpenAI as jest.MockedClass<typeof OpenAI>;
const MockedResponseManager = ResponseManager as jest.MockedClass<typeof ResponseManager>;

describe('messageProcessingUtils', () => {
  let mockClientInstance: jest.Mocked<WebClient>;
  let mockLlmClientInstance: jest.Mocked<OpenAI>;

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    mockReplies.mockClear();
    mockInfo.mockClear();
    mockAuthTest.mockClear();
    mockReactionsAdd.mockClear();
    mockReactionsRemove.mockClear();
    mockPostMessage.mockClear();
    // No need to clear chat.completions.create here before instantiation

    // Instantiate the clients using the mocked constructors
    mockClientInstance = new MockedWebClient() as jest.Mocked<WebClient>;
    mockLlmClientInstance = new MockedOpenAI() as jest.Mocked<OpenAI>;

    // Configure default mock behaviors
    const mockStream = (async function* () {
      yield { choices: [{ delta: { content: 'Hello ' } }] };
      yield { choices: [{ delta: { content: 'World' } }] };
    })();
    // mockCompletionsCreate.mockResolvedValue(mockStream); // Cannot set this on the external one
    // Set the mock implementation on the instance method
    (mockLlmClientInstance.chat.completions.create as jest.Mock).mockResolvedValue(mockStream);

    MockedResponseManager.prototype.startNewMessageWithPlaceholder = jest.fn();
    MockedResponseManager.prototype.appendToMessage = jest.fn();
    MockedResponseManager.prototype.finalizeMessage = jest
      .fn()
      .mockResolvedValue({ ts: 'final-ts-123', text: 'Final message' });

    const mockExecuteToolCalls = executeToolCalls as jest.Mock;
    mockExecuteToolCalls.mockResolvedValue([]);
  });

  // --- Tests for individual functions ---

  describe('fetchSlackThread', () => {
    it('should return empty array if thread_ts is undefined', async () => {
      const messages = await fetchSlackThread(mockClientInstance, 'C123', undefined);
      expect(messages).toEqual([]);
      expect(mockReplies).not.toHaveBeenCalled();
    });

    it('should call conversations.replies and return messages if thread_ts is provided', async () => {
      const mockMessages = [{ ts: '123', text: 'Reply 1' }];
      mockReplies.mockResolvedValue({
        ok: true,
        messages: mockMessages,
      });
      const messages = await fetchSlackThread(mockClientInstance, 'C123', 'ts1');
      expect(messages).toEqual(mockMessages);
      expect(mockReplies).toHaveBeenCalledWith({
        channel: 'C123',
        ts: 'ts1',
        include_all_metadata: true,
      });
    });

    it('should throw error if conversations.replies fails', async () => {
      mockReplies.mockResolvedValue({
        ok: false,
        error: 'fetch_failed',
      });
      await expect(fetchSlackThread(mockClientInstance, 'C123', 'ts1')).rejects.toThrow(
        'Failed to fetch thread replies: fetch_failed',
      );
      expect(mockReplies).toHaveBeenCalledWith({
        channel: 'C123',
        ts: 'ts1',
        include_all_metadata: true,
      });
    });
  });

  describe('fetchUserInfo', () => {
    it('should call users.info and return formatted user info on success', async () => {
      const mockUserResponse = {
        ok: true,
        user: {
          id: 'U123',
          tz: 'America/New_York',
          tz_offset: -14400,
          profile: {
            real_name: 'Test User',
            display_name: 'tester',
            real_name_normalized: 'test user',
          },
        },
      };
      mockInfo.mockResolvedValue(mockUserResponse);
      const userInfo = await fetchUserInfo(mockClientInstance, 'U123');
      expect(userInfo).toEqual({
        slack_ID: '<@U123>',
        preferred_name: 'tester',
        real_name: 'Test User',
        time_zone: 'America/New_York',
        time_zone_offset: -14400,
      });
      expect(mockInfo).toHaveBeenCalledWith({ user: 'U123' });
    });

    it('should return error object if users.info returns ok: false', async () => {
      mockInfo.mockResolvedValue({ ok: false, error: 'user_not_found' });
      const userInfo = await fetchUserInfo(mockClientInstance, 'U123');
      expect(userInfo).toEqual({
        slack_ID: '<@U123>',
        error: 'Could not fetch user info',
      });
      expect(mockInfo).toHaveBeenCalledWith({ user: 'U123' });
    });

    it('should return error object if users.info throws', async () => {
      const error = new Error('Network Error');
      mockInfo.mockRejectedValue(error);
      const userInfo = await fetchUserInfo(mockClientInstance, 'U123');
      expect(userInfo).toEqual({
        slack_ID: '<@U123>',
        error: 'Exception fetching user info',
      });
      expect(mockInfo).toHaveBeenCalledWith({ user: 'U123' });
    });
  });

  describe('convertSlackHistoryToLLMHistory', () => {
    const currentUserMessageTs = '100.0';
    const botUserId = 'UBOT1';

    const baseMessages: SlackMessage[] = [
      { channel: 'C1', ts: '50.0', user: 'U1', text: 'Hello' },
      {
        channel: 'C1',
        ts: '60.0',
        bot_id: botUserId,
        text: 'Hi there!',
        metadata: { event_type: 'assistant_message' },
      },
      { channel: 'C1', ts: '70.0', user: 'U2', text: 'Question?' },
      // Current message - should be filtered out
      { channel: 'C1', ts: currentUserMessageTs, user: 'U1', text: 'My current message' },
      // Tool call message from bot
      {
        channel: 'C1',
        ts: '80.0',
        bot_id: botUserId,
        text: 'Using a tool',
        metadata: {
          event_type: 'assistant_message',
          event_payload: {
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'toolA', arguments: '{}' } }],
          },
        },
      },
      // Tool result message (posted by bot)
      {
        channel: 'C1',
        ts: '90.0',
        bot_id: botUserId,
        text: 'Tool A result',
        metadata: { event_type: 'tool_result', event_payload: { tool_call_id: 'call_1' } },
      },
    ];

    it('should convert user and assistant messages correctly, prepending user ID', () => {
      const history = convertSlackHistoryToLLMHistory([...baseMessages], currentUserMessageTs, botUserId);
      expect(history).toEqual([
        { role: 'user', content: '<@U1>: Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: '<@U2>: Question?' },
        {
          role: 'assistant',
          content: 'Using a tool',
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'toolA', arguments: '{}' } }],
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'Tool A result' },
      ]);
    });

    it('should filter out the current user message', () => {
      const history = convertSlackHistoryToLLMHistory([...baseMessages], currentUserMessageTs, botUserId);
      // Check content safely
      expect(
        history.find((msg) => typeof msg.content === 'string' && msg.content.includes('My current message')),
      ).toBeUndefined();
    });

    it('should handle messages without text or user/bot id gracefully', () => {
      const messagesWithEmpty = [
        ...baseMessages,
        { channel: 'C1', ts: '55.0', user: 'U1' }, // No text
        { channel: 'C1', ts: '65.0', text: 'Orphan message' }, // No user/bot
      ] as SlackMessage[];
      const history = convertSlackHistoryToLLMHistory(messagesWithEmpty, currentUserMessageTs, botUserId);
      // Should still contain the valid messages
      expect(history.length).toBe(5); // Original valid messages
      expect(history.find((msg) => msg.content === 'Orphan message')).toBeUndefined();
    });

    // Add more tests for edge cases like bot ID matching, different metadata, etc.
  });

  describe('buildInitialLlmThread', () => {
    const history: ChatMessage[] = [{ role: 'user', content: '<@U1>: Previous message' }];
    const userInfo: UserInfo = { slack_ID: '<@U2>', preferred_name: 'User Two' };
    const userMessageText = 'New message from user';

    it('should construct the thread with system prompts, history, user info, and new message for a user message', () => {
      const thread = buildInitialLlmThread(history, userInfo, userMessageText, true);
      expect(thread).toEqual([
        { role: 'system', content: DEFAULT_SYSTEM_CONTENT },
        expect.objectContaining({ role: 'system', content: expect.stringContaining('The current date and time is') }),
        { role: 'system', content: 'Here is the conversation history (if any):' },
        ...history,
        { role: 'system', content: `The following message is from: ${JSON.stringify(userInfo)}` },
        { role: 'user', content: userMessageText },
      ]);
    });

    it('should construct the thread correctly for a system event message', () => {
      const systemUserInfo: UserInfo = { slack_ID: 'Event', source: 'system event (test_subtype)' };
      const thread = buildInitialLlmThread(history, systemUserInfo, userMessageText, false);
      expect(thread).toEqual([
        { role: 'system', content: DEFAULT_SYSTEM_CONTENT },
        expect.objectContaining({ role: 'system', content: expect.stringContaining('The current date and time is') }),
        { role: 'system', content: 'Here is the conversation history (if any):' },
        ...history,
        { role: 'system', content: `The following message is from ${systemUserInfo.source}.` },
        { role: 'user', content: userMessageText }, // Still added as 'user' role based on param
      ]);
    });
  });

  describe('addFeedbackHintReactions', () => {
    it('should call reactions.add for +1 and -1', async () => {
      await addFeedbackHintReactions(mockClientInstance, 'C123', 'msgTs');
      expect(mockReactionsAdd).toHaveBeenCalledTimes(2);
      expect(mockReactionsAdd).toHaveBeenCalledWith({
        name: '+1',
        channel: 'C123',
        timestamp: 'msgTs',
      });
      expect(mockReactionsAdd).toHaveBeenCalledWith({
        name: '-1',
        channel: 'C123',
        timestamp: 'msgTs',
      });
    });

    it('should log error if reactions.add fails', async () => {
      const error = new Error('Reaction failed');
      mockReactionsAdd.mockRejectedValueOnce(error);
      await addFeedbackHintReactions(mockClientInstance, 'C123', 'msgTs');
      expect(mockReactionsAdd).toHaveBeenCalledTimes(2); // Still attempts both
      expect(logger.error).toHaveBeenCalledWith(
        { error, messageTs: 'msgTs', channel: 'C123' },
        'Failed to add feedback hint reactions',
      );
    });
  });

  describe('runLlmConversation', () => {
    let initialThread: ChatMessage[];
    const channel = 'C123';
    const ts = 'trigger-ts-123';

    beforeEach(() => {
      initialThread = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'User message' },
      ];
      // Reset specific mocks used heavily here
      (executeToolCalls as jest.Mock).mockClear();
      mockPostMessage.mockClear();
      (MockedResponseManager.prototype.finalizeMessage as jest.Mock).mockClear();
    });

    it('should handle simple response with no tool calls', async () => {
      // Mock LLM stream for simple response
      const mockStream = (async function* () {
        yield { choices: [{ delta: { content: 'Simple reply' } }] };
      })();
      // mockCompletionsCreate.mockResolvedValueOnce(mockStream); // Cannot set on external one
      (mockLlmClientInstance.chat.completions.create as jest.Mock).mockResolvedValueOnce(mockStream);

      // Mock finalize message
      (MockedResponseManager.prototype.finalizeMessage as jest.Mock).mockResolvedValueOnce({
        ts: 'reply-ts',
        text: 'Simple reply',
      });

      const finalizedTs = await runLlmConversation(
        mockLlmClientInstance,
        mockClientInstance,
        new MockedResponseManager({ client: mockClientInstance, say: jest.fn() }), // Provide valid args
        initialThread,
        channel,
        ts,
      );

      expect(finalizedTs).toBe('reply-ts');
      // expect(mockCompletionsCreate).toHaveBeenCalledTimes(1); // Cannot check external one
      expect(mockLlmClientInstance.chat.completions.create).toHaveBeenCalledTimes(1);
      expect(executeToolCalls).not.toHaveBeenCalled();
      expect(mockPostMessage).not.toHaveBeenCalled(); // No tool call description message
    });

    it('should handle one loop of tool calls and then a final response', async () => {
      const toolCallId = 'call123';
      const toolName = 'get_weather';
      const toolArgs = '{ "location": "London" }';
      const toolResult = '{ "temp": "15C" }';

      // Mock LLM stream for tool call
      const mockToolCallStream = (async function* () {
        yield {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: toolCallId, type: 'function', function: { name: toolName, arguments: '' } },
                ],
              },
            },
          ],
        };
        yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: toolArgs } }] } }] };
        // No delta.content
      })();
      // Mock LLM stream for final response after tool call
      const mockFinalStream = (async function* () {
        yield { choices: [{ delta: { content: 'Weather is 15C' } }] };
      })();

      // mockCompletionsCreate.mockResolvedValueOnce(mockToolCallStream).mockResolvedValueOnce(mockFinalStream);
      (mockLlmClientInstance.chat.completions.create as jest.Mock)
        .mockResolvedValueOnce(mockToolCallStream)
        .mockResolvedValueOnce(mockFinalStream);

      // Mock finalize message (first time will be empty text, second time has final text)
      (MockedResponseManager.prototype.finalizeMessage as jest.Mock)
        .mockResolvedValueOnce({ ts: 'tool-call-msg-ts', text: '' }) // Response might be empty if only tool calls
        .mockResolvedValueOnce({ ts: 'final-reply-ts', text: 'Weather is 15C' });

      // Mock executeToolCalls result
      const mockToolResults: ChatMessage[] = [{ role: 'tool', tool_call_id: toolCallId, content: toolResult }];
      (executeToolCalls as jest.Mock).mockResolvedValueOnce(mockToolResults);

      // Mock the postMessage for tool description
      mockPostMessage.mockResolvedValue({ ok: true, ts: 'tool-desc-ts' });

      const finalizedTs = await runLlmConversation(
        mockLlmClientInstance,
        mockClientInstance,
        new MockedResponseManager({ client: mockClientInstance, say: jest.fn() }), // Provide valid args
        initialThread,
        channel,
        ts,
      );

      expect(finalizedTs).toBe('final-reply-ts');
      // expect(mockCompletionsCreate).toHaveBeenCalledTimes(2);
      expect(mockLlmClientInstance.chat.completions.create).toHaveBeenCalledTimes(2);
      expect(executeToolCalls).toHaveBeenCalledTimes(1);
      expect(executeToolCalls).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: toolCallId, function: { name: toolName, arguments: toolArgs } }),
        ]),
        expect.any(Object), // toolImplementations
      );
      // Check that the tool description message was posted
      expect(mockPostMessage).toHaveBeenCalledTimes(1);
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: channel,
          thread_ts: ts,
          text: expect.stringContaining(toolName),
          metadata: expect.objectContaining({ event_type: 'tool_calls' }),
        }),
      );
      // Check that the LLM was called the second time with the tool result
      // expect(mockCompletionsCreate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      expect(mockLlmClientInstance.chat.completions.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          messages: expect.arrayContaining([
            ...initialThread,
            {
              role: 'assistant',
              content: null,
              tool_calls: expect.arrayContaining([expect.objectContaining({ id: toolCallId })]),
            },
            ...mockToolResults,
          ]),
        }),
      );
    });

    it('should stop after max iterations and post warning', async () => {
      const toolCallId = 'call123';
      const toolName = 'get_weather';
      const toolArgs = '{}';
      const toolResult = '{ "temp": "15C" }';

      // Mock LLM stream to always return a tool call
      const mockToolCallStream = (async function* () {
        yield {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: toolCallId, type: 'function', function: { name: toolName, arguments: toolArgs } },
                ],
              },
            },
          ],
        };
      })();
      // mockCompletionsCreate.mockResolvedValue(mockToolCallStream); // Always return tool call
      (mockLlmClientInstance.chat.completions.create as jest.Mock).mockResolvedValue(mockToolCallStream); // Always return tool call

      // Mock finalize message (always empty text)
      (MockedResponseManager.prototype.finalizeMessage as jest.Mock).mockResolvedValue({ ts: 'loop-ts', text: '' });

      // Mock executeToolCalls result
      const mockToolResults: ChatMessage[] = [{ role: 'tool', tool_call_id: toolCallId, content: toolResult }];
      (executeToolCalls as jest.Mock).mockResolvedValue(mockToolResults);

      // Mock postMessage for tool description and max iterations warning
      mockPostMessage.mockResolvedValue({ ok: true, ts: 'some-ts' });

      const maxIterations = 2; // Set low for testing
      // Need access to the mocked config object here
      const mockedConfig = require('../../config').config;
      jest.spyOn(mockedConfig, 'maxToolCallIterations', 'get').mockReturnValue(maxIterations);

      const finalizedTs = await runLlmConversation(
        mockLlmClientInstance,
        mockClientInstance,
        new MockedResponseManager({ client: mockClientInstance, say: jest.fn() }), // Provide valid args
        initialThread,
        channel,
        ts,
      );

      expect(finalizedTs).toBe('loop-ts'); // TS of the last (empty) message before loop exit
      // expect(mockCompletionsCreate).toHaveBeenCalledTimes(maxIterations);
      expect(mockLlmClientInstance.chat.completions.create).toHaveBeenCalledTimes(maxIterations);
      expect(executeToolCalls).toHaveBeenCalledTimes(maxIterations);
      // Check that the max iterations warning message was posted
      expect(mockPostMessage).toHaveBeenCalledTimes(maxIterations + 1); // Tool descriptions + warning
      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: channel,
          thread_ts: ts,
          text: expect.stringContaining('maximum tool call iterations'),
        }),
      );
      expect(logger.warn).toHaveBeenCalledWith({ triggeringMessageTs: ts }, 'Reached max tool call iterations.');
    });

    it('should handle LLM stream error gracefully', async () => {
      const error = new Error('LLM Error');
      // mockCompletionsCreate.mockRejectedValueOnce(error);
      (mockLlmClientInstance.chat.completions.create as jest.Mock).mockRejectedValueOnce(error);

      await expect(
        runLlmConversation(
          mockLlmClientInstance,
          mockClientInstance,
          new MockedResponseManager({ client: mockClientInstance, say: jest.fn() }), // Provide valid args
          initialThread,
          channel,
          ts,
        ),
      ).rejects.toThrow(error);
      // Should not have proceeded to tool calls or posting messages (error bubbles up)
      expect(executeToolCalls).not.toHaveBeenCalled();
      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it('should handle executeToolCalls error gracefully', async () => {
      const toolCallId = 'call123';
      const toolName = 'get_weather';
      const toolArgs = '{}';

      // Mock LLM stream for tool call
      const mockToolCallStream = (async function* () {
        yield {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: toolCallId, type: 'function', function: { name: toolName, arguments: toolArgs } },
                ],
              },
            },
          ],
        };
      })();
      // mockCompletionsCreate.mockResolvedValueOnce(mockToolCallStream);
      (mockLlmClientInstance.chat.completions.create as jest.Mock).mockResolvedValueOnce(mockToolCallStream);
      (MockedResponseManager.prototype.finalizeMessage as jest.Mock).mockResolvedValueOnce({
        ts: 'tool-call-msg-ts',
        text: '',
      });
      mockPostMessage.mockResolvedValue({ ok: true, ts: 'tool-desc-ts' });

      // Mock executeToolCalls to throw an error
      const toolError = new Error('Tool Execution Failed');
      (executeToolCalls as jest.Mock).mockRejectedValueOnce(toolError);

      await expect(
        runLlmConversation(
          mockLlmClientInstance,
          mockClientInstance,
          new MockedResponseManager({ client: mockClientInstance, say: jest.fn() }), // Provide valid args
          initialThread,
          channel,
          ts,
        ),
      ).rejects.toThrow(toolError);

      // Should have posted tool description, but failed before next LLM call
      expect(mockPostMessage).toHaveBeenCalledTimes(1);
      // expect(mockCompletionsCreate).toHaveBeenCalledTimes(1); // Only the first call
      expect(mockLlmClientInstance.chat.completions.create).toHaveBeenCalledTimes(1); // Only the first call
    });
  });

  describe('handleIncomingMessage', () => {
    let baseSlackMessage: SlackMessage;
    let handleArgs: Partial<HandleIncomingMessageArgs>; // Use partial args type

    beforeEach(() => {
      baseSlackMessage = {
        channel: 'C123',
        user: 'U123',
        text: 'Test message',
        ts: '12345.678',
        thread_ts: undefined, // No thread by default
      };

      handleArgs = {
        llmClient: mockLlmClientInstance,
        client: mockClientInstance,
        slackMessage: baseSlackMessage,
        say: jest.fn(), // Provide a mock SayFn
        eventType: 'message',
        // botUserId will be fetched by default unless provided
      };

      // Reset mocks specific to this orchestrator test
      mockReplies.mockClear();
      mockInfo.mockClear();
      mockAuthTest.mockClear();
      mockReactionsAdd.mockClear();
      mockReactionsRemove.mockClear();
      (executeToolCalls as jest.Mock).mockClear();
      // mockCompletionsCreate.mockClear(); // Cannot clear the external one anymore
      (MockedResponseManager.prototype.finalizeMessage as jest.Mock).mockClear();

      // Mock helpers that handleIncomingMessage calls
      // Default successful mocks, can be overridden per test
      mockReplies.mockResolvedValue({ ok: true, messages: [] }); // No history by default
      mockInfo.mockResolvedValue({ ok: true, user: { id: 'U123', profile: { display_name: 'TestUser' } } });
      mockAuthTest.mockResolvedValue({ ok: true, bot_id: 'UBOTID' });
      mockReactionsAdd.mockResolvedValue({ ok: true });
      mockReactionsRemove.mockResolvedValue({ ok: true });
      (MockedResponseManager.prototype.finalizeMessage as jest.Mock).mockResolvedValue({
        ts: 'final-ts',
        text: 'Final response',
      });

      // Mock LLM response (simple, no tools by default)
      const mockStream = (async function* () {
        yield { choices: [{ delta: { content: 'Final response' } }] };
      })();
      // mockCompletionsCreate.mockResolvedValue(mockStream); // Cannot set this on the external one
      (mockLlmClientInstance.chat.completions.create as jest.Mock).mockResolvedValue(mockStream);
    });

    it('should handle a simple user message in a channel (no thread)', async () => {
      await handleIncomingMessage(handleArgs as HandleIncomingMessageArgs); // Cast to full type

      // Check thinking reaction added/removed
      expect(mockReactionsAdd).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'thinking_face', timestamp: baseSlackMessage.ts }),
      );
      expect(mockReactionsRemove).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'thinking_face', timestamp: baseSlackMessage.ts }),
      );

      // Check history fetch (should not be called as no thread_ts)
      expect(mockReplies).not.toHaveBeenCalled();
      // Check user info fetch
      expect(mockInfo).toHaveBeenCalledWith({ user: 'U123' });
      // Check bot user ID fetch (implicitly called by getBotUserId helper)
      expect(mockAuthTest).toHaveBeenCalledTimes(1);

      // Check LLM call
      // expect(mockCompletionsCreate).toHaveBeenCalledTimes(1); // Cannot check external one
      expect(mockLlmClientInstance.chat.completions.create).toHaveBeenCalledTimes(1);
      expect(mockLlmClientInstance.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'system', content: DEFAULT_SYSTEM_CONTENT }),
            expect.objectContaining({ role: 'user', content: baseSlackMessage.text }),
            expect.objectContaining({ role: 'system', content: expect.stringContaining('TestUser') }),
          ]),
        }),
      );

      // Check final message handling
      expect(MockedResponseManager.prototype.finalizeMessage).toHaveBeenCalledTimes(1);
      expect(mockReactionsAdd).toHaveBeenCalledWith(expect.objectContaining({ name: '+1', timestamp: 'final-ts' }));
      expect(mockReactionsAdd).toHaveBeenCalledWith(expect.objectContaining({ name: '-1', timestamp: 'final-ts' }));

      // Check no errors logged
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('should handle a message within an existing thread', async () => {
      // No need for non-null assertion if handleArgs is cast later
      (handleArgs.slackMessage as SlackMessage).thread_ts = 'thread-ts-123';
      const mockHistory = [
        { user: 'UOTHER', text: 'First message', ts: 'thread-ts-123' },
        { bot_id: 'UBOTID', text: 'Bot reply', ts: 'thread-ts-124' },
      ];
      mockReplies.mockResolvedValue({ ok: true, messages: mockHistory });

      await handleIncomingMessage(handleArgs as HandleIncomingMessageArgs); // Cast to full type

      expect(mockReplies).toHaveBeenCalledWith({
        channel: baseSlackMessage.channel,
        ts: 'thread-ts-123',
        include_all_metadata: true,
      });
      expect(mockLlmClientInstance.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            // Check for converted history messages
            expect.objectContaining({ role: 'user', content: '<@UOTHER>: First message' }),
            expect.objectContaining({ role: 'assistant', content: 'Bot reply' }),
            // Check for current user message
            expect.objectContaining({ role: 'user', content: baseSlackMessage.text }),
          ]),
        }),
      );
      // Ensure ResponseManager's say function posts to the thread
      const sayFn = handleArgs.say as jest.Mock;
      expect(sayFn).not.toHaveBeenCalled(); // Should use ResponseManager internal say
      // We mocked the prototype, so we can check calls on finalizeMessage etc.
      // If we hadn't mocked the prototype, we'd check the say function passed to constructor
      expect(MockedResponseManager.prototype.finalizeMessage).toHaveBeenCalled();
    });

    it('should handle an app_mention event', async () => {
      handleArgs.eventType = 'app_mention';
      handleArgs.say = undefined; // app_mention events don't have direct say fn

      // Mock postMessage for the responseManagerSay fallback
      mockPostMessage.mockResolvedValue({ ok: true, ts: 'post-ts' });

      // Mock finalizeMessage to return the ts from postMessage
      (MockedResponseManager.prototype.finalizeMessage as jest.Mock).mockResolvedValue({
        ts: 'post-ts',
        text: 'Mention Response',
      });

      await handleIncomingMessage(handleArgs as HandleIncomingMessageArgs); // Cast to full type

      expect(mockInfo).toHaveBeenCalledWith({ user: 'U123' }); // User who mentioned
      expect(mockLlmClientInstance.chat.completions.create).toHaveBeenCalledTimes(1);
      expect(mockReactionsAdd).toHaveBeenCalledWith(expect.objectContaining({ name: '+1', timestamp: 'post-ts' }));
      expect(mockReactionsRemove).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'thinking_face', timestamp: baseSlackMessage.ts }),
      );
      // Check that postMessage was likely called by the fallback say function
      expect(mockPostMessage).toHaveBeenCalled();
    });

    it('should handle fetchSlackThread failure', async () => {
      (handleArgs.slackMessage as SlackMessage).thread_ts = 'thread-ts-123';
      const error = new Error('Fetch thread failed');
      mockReplies.mockRejectedValue(error);

      await handleIncomingMessage(handleArgs as HandleIncomingMessageArgs); // Cast to full type

      expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ err: error }), 'Error in message handler');
      expect(handleArgs.say).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Yikums! Something went wrong'),
          thread_ts: 'thread-ts-123', // Error reported in thread
        }),
      );
      // Ensure thinking face is still removed
      expect(mockReactionsRemove).toHaveBeenCalledWith(expect.objectContaining({ name: 'thinking_face' }));
      // Should not proceed to LLM call etc.
      expect(mockLlmClientInstance.chat.completions.create).not.toHaveBeenCalled();
    });

    it('should handle fetchUserInfo failure', async () => {
      const error = new Error('Fetch user failed');
      mockInfo.mockRejectedValue(error);

      await handleIncomingMessage(handleArgs as HandleIncomingMessageArgs); // Cast to full type

      // Should still proceed but use error info in system prompt
      expect(mockLlmClientInstance.chat.completions.create).toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled(); // Error is handled locally in fetchUserInfo and logged there
      expect(logger.warn).not.toHaveBeenCalled(); // No direct warning expected here
      // Check that flow completed
      expect(mockReactionsRemove).toHaveBeenCalledWith(expect.objectContaining({ name: 'thinking_face' }));
      expect(MockedResponseManager.prototype.finalizeMessage).toHaveBeenCalled();
    });

    it('should handle runLlmConversation failure', async () => {
      const error = new Error('LLM run failed');
      // To mock runLlmConversation failure, we mock the first call it makes, e.g., llmClient.chat.completions.create
      (mockLlmClientInstance.chat.completions.create as jest.Mock).mockRejectedValue(error);

      await handleIncomingMessage(handleArgs as HandleIncomingMessageArgs); // Cast to full type

      expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ err: error }), 'Error in message handler');
      expect(handleArgs.say).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Yikums! Something went wrong'),
          thread_ts: baseSlackMessage.ts, // Error reported in thread (or thread_ts if present)
        }),
      );
      expect(mockReactionsRemove).toHaveBeenCalledWith(expect.objectContaining({ name: 'thinking_face' }));
    });

    it('should handle bot User ID fetch failure', async () => {
      mockAuthTest.mockResolvedValue({ ok: false, error: 'auth_failed' });

      await handleIncomingMessage(handleArgs as HandleIncomingMessageArgs); // Cast to full type

      // Should still proceed, but history conversion might be affected if bot messages exist
      expect(mockLlmClientInstance.chat.completions.create).toHaveBeenCalled();
      // Check logs for warning about bot ID fetch
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ authTest: { ok: false, error: 'auth_failed' } }),
        'Could not fetch bot_id via auth.test',
      );
      // Check flow completed
      expect(mockReactionsRemove).toHaveBeenCalledWith(expect.objectContaining({ name: 'thinking_face' }));
      expect(MockedResponseManager.prototype.finalizeMessage).toHaveBeenCalled();
    });

    it('should use provided botUserId if available', async () => {
      handleArgs.botUserId = 'PROVIDED_BOT_ID';
      await handleIncomingMessage(handleArgs as HandleIncomingMessageArgs); // Cast to full type
      // Should not call auth.test
      expect(mockAuthTest).not.toHaveBeenCalled();
      // Check LLM call includes history potentially converted using the provided ID
      expect(mockLlmClientInstance.chat.completions.create).toHaveBeenCalled();
    });
  });
});
