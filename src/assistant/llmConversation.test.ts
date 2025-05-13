import type { SayFn } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import type { ChatPostMessageResponse } from '@slack/web-api';
import { OpenAI } from 'openai';
import type { ChatCompletionChunk } from 'openai/resources/chat/completions';
import ResponseManager from './ResponseManager';
import executeToolCalls from './executeToolCalls';
import { handleIncomingMessage, runLlmConversation } from './llmConversation';
import type { ChatMessage } from './types';

// --- Mock Implementations ---
const mockReplies = jest.fn();
const mockInfo = jest.fn();
const mockAuthTest = jest.fn();
const mockReactionsAdd = jest.fn().mockResolvedValue({ ok: true });
const mockReactionsRemove = jest.fn().mockResolvedValue({ ok: true });
const mockPostMessage = jest.fn().mockResolvedValue({ ok: true, ts: '123.456' });

// --- Mock Factories ---
jest.mock('@slack/web-api', () => ({
  WebClient: jest.fn().mockImplementation(() => ({
    conversations: { replies: mockReplies },
    users: { info: mockInfo },
    auth: { test: mockAuthTest },
    reactions: { add: mockReactionsAdd, remove: mockReactionsRemove },
    chat: { postMessage: mockPostMessage },
  })),
}));

jest.mock('openai', () => ({
  OpenAI: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
  })),
}));

jest.mock('./ResponseManager');
jest.mock('./executeToolCalls');
jest.mock('../services/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../config', () => ({
  config: {
    modelName: 'test-model',
    maxToolCallIterations: 5,
  },
}));

// Get mock instances type safely
const MockedWebClient = WebClient as jest.MockedClass<typeof WebClient>;
const MockedOpenAI = OpenAI as jest.MockedClass<typeof OpenAI>;
const MockedResponseManager = ResponseManager as jest.MockedClass<typeof ResponseManager>;

describe('llmConversation', () => {
  let mockClientInstance: WebClient;
  let mockLlmClientInstance: OpenAI;
  let mockSay: SayFn;

  beforeEach(() => {
    jest.clearAllMocks();

    // Instantiate the clients using the mocked constructors
    mockClientInstance = {
      reactions: {
        add: mockReactionsAdd,
        remove: mockReactionsRemove,
      },
      conversations: {
        replies: mockReplies,
        info: mockInfo,
      },
      auth: {
        test: mockAuthTest,
      },
      chat: {
        postMessage: mockPostMessage,
      },
    } as unknown as WebClient;
    mockLlmClientInstance = new MockedOpenAI() as OpenAI;

    // Configure default mock behaviors
    const mockStream = (async function* () {
      yield { choices: [{ delta: { content: 'Hello ' } }] };
      yield { choices: [{ delta: { content: 'World' } }] };
    })();
    (mockLlmClientInstance.chat.completions.create as jest.Mock).mockResolvedValue(mockStream);

    MockedResponseManager.prototype.startNewMessageWithPlaceholder = jest.fn();
    MockedResponseManager.prototype.appendToMessage = jest.fn();
    MockedResponseManager.prototype.finalizeMessage = jest
      .fn()
      .mockResolvedValue({ ts: 'final-ts-123', text: 'Final message' });

    const mockExecuteToolCalls = executeToolCalls as jest.Mock;
    mockExecuteToolCalls.mockResolvedValue([]);

    mockSay = jest.fn();
  });

  describe('runLlmConversation', () => {
    it('should handle basic conversation without tool calls', async () => {
      const responseManager = new MockedResponseManager({
        client: mockClientInstance,
        say: mockSay,
        channelOrThreadTs: '1678886400.000001',
      });
      const finalTs = await runLlmConversation({
        llmClient: mockLlmClientInstance,
        client: mockClientInstance,
        responseManager,
        initialLlmThread: [],
        slackChannel: 'C123',
        triggeringMessageTs: '1678886400.000001',
        userIsAdmin: false,
      });
      expect(finalTs).toBeDefined();
    });

    it('should handle tool calls and responses', async () => {
      const toolCallStream = (async function* () {
        yield {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_123',
                    function: {
                      name: 'searchDocuments',
                      arguments: '{"query": "test query"}',
                    },
                  },
                ],
              },
            },
          ],
        };
      })();

      mockLlmClientInstance.chat.completions.create = jest.fn().mockResolvedValue(toolCallStream);

      const responseManager = new MockedResponseManager({
        client: mockClientInstance,
        say: mockSay,
        channelOrThreadTs: '1678886400.000001',
      });
      const finalTs = await runLlmConversation({
        llmClient: mockLlmClientInstance,
        client: mockClientInstance,
        responseManager,
        initialLlmThread: [],
        slackChannel: 'C123',
        triggeringMessageTs: '1678886400.000001',
        userIsAdmin: false,
      });
      expect(finalTs).toBeDefined();
    });
  });

  describe('handleIncomingMessage', () => {
    it('should process incoming message and add reactions', async () => {
      const say = jest.fn();
      mockReplies.mockResolvedValue({ ok: true, messages: [] });
      mockInfo.mockResolvedValue({
        ok: true,
        user: {
          id: 'U123',
          profile: { real_name: 'Test User', display_name: 'tester' },
          tz: 'America/New_York',
          tz_offset: -14400,
        },
      });
      mockAuthTest.mockResolvedValue({ ok: true, user_id: 'BOT123' });

      await handleIncomingMessage({
        llmClient: mockLlmClientInstance,
        client: mockClientInstance,
        slackMessage: {
          channel: 'C123',
          user: 'U123',
          text: 'Hello',
          ts: 'ts123',
        },
        say,
        includeChannelContext: false,
      });

      expect(mockReactionsAdd).toHaveBeenCalledWith({
        name: 'thinking_face',
        channel: 'C123',
        timestamp: 'ts123',
      });
      expect(mockReactionsRemove).toHaveBeenCalledWith({
        name: 'thinking_face',
        channel: 'C123',
        timestamp: 'ts123',
      });
    });

    it('should handle errors gracefully', async () => {
      const say = jest.fn();
      mockReplies.mockRejectedValue(new Error('Network error'));

      await handleIncomingMessage({
        llmClient: mockLlmClientInstance,
        client: mockClientInstance,
        slackMessage: {
          channel: 'C123',
          user: 'U123',
          text: 'Hello',
          ts: 'ts123',
        },
        say,
        includeChannelContext: false,
      });

      expect(say).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Something went wrong'),
        }),
      );
    });
  });
});

describe('runLlmConversation', () => {
  let mockLlmClient: OpenAI;
  let mockWebClient: WebClient;
  let mockSay: jest.MockedFunction<SayFn>;
  let mockResponseManager: jest.Mocked<ResponseManager>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock OpenAI client
    mockLlmClient = {
      chat: {
        completions: {
          create: jest.fn(),
        },
      },
    } as unknown as OpenAI;

    // Mock WebClient
    mockWebClient = {
      chat: {
        postMessage: jest.fn().mockResolvedValue({ ok: true, ts: '123.456' }),
      },
    } as unknown as WebClient;

    // Mock say function
    mockSay = jest.fn();

    // Mock ResponseManager
    mockResponseManager = {
      startNewMessageWithPlaceholder: jest.fn(),
      appendToMessage: jest.fn(),
      finalizeMessage: jest.fn(),
    } as unknown as jest.Mocked<ResponseManager>;
  });

  it('should handle basic conversation without tool calls', async () => {
    // Mock LLM response
    const mockStream: AsyncIterable<ChatCompletionChunk> = {
      [Symbol.asyncIterator]: async function* () {
        yield {
          id: 'mock-id',
          choices: [
            {
              delta: {
                content: 'Hello',
              },
              index: 0,
              finish_reason: null,
            },
          ],
          created: Date.now(),
          model: 'gpt-4',
          object: 'chat.completion.chunk',
        };
      },
    };
    (mockLlmClient.chat.completions.create as jest.Mock).mockResolvedValue(mockStream);

    // Mock ResponseManager behavior
    (mockResponseManager.finalizeMessage as jest.Mock).mockResolvedValue({
      text: 'Hello',
      ts: '123.456',
      channel: 'C123',
    });

    const initialThread: ChatMessage[] = [{ role: 'user', content: 'Hi' }];

    const finalTs = await runLlmConversation({
      llmClient: mockLlmClient,
      client: mockWebClient,
      responseManager: mockResponseManager,
      initialLlmThread: initialThread,
      slackChannel: 'C123',
      triggeringMessageTs: '123.456',
      userIsAdmin: false,
    });

    expect(finalTs).toBe('123.456');
    expect(mockResponseManager.startNewMessageWithPlaceholder).toHaveBeenCalledWith('_thinking..._');
    expect(mockResponseManager.appendToMessage).toHaveBeenCalledWith('Hello');
    expect(mockResponseManager.finalizeMessage).toHaveBeenCalled();
  });

  it('should handle tool calls in conversation', async () => {
    // Mock LLM response with tool calls
    const mockStream: AsyncIterable<ChatCompletionChunk> = {
      [Symbol.asyncIterator]: async function* () {
        yield {
          id: 'mock-id',
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_123',
                    function: {
                      name: 'searchDocuments',
                      arguments: '{"query": "test query"}',
                    },
                  },
                ],
              },
              index: 0,
              finish_reason: null,
            },
          ],
          created: Date.now(),
          model: 'gpt-4',
          object: 'chat.completion.chunk',
        };
      },
    };
    (mockLlmClient.chat.completions.create as jest.Mock).mockResolvedValue(mockStream);

    // Mock ResponseManager behavior
    (mockResponseManager.finalizeMessage as jest.Mock).mockResolvedValue({
      text: 'Tool call response',
      ts: '123.456',
      channel: 'C123',
    });

    // Mock WebClient postMessage for tool call
    (mockWebClient.chat.postMessage as jest.Mock).mockResolvedValue({
      ok: true,
      ts: '123.457',
    } as ChatPostMessageResponse);

    const initialThread: ChatMessage[] = [{ role: 'user', content: 'Use a tool' }];

    const finalTs = await runLlmConversation({
      llmClient: mockLlmClient,
      client: mockWebClient,
      responseManager: mockResponseManager,
      initialLlmThread: initialThread,
      slackChannel: 'C123',
      triggeringMessageTs: '123.456',
      userIsAdmin: false,
    });

    expect(finalTs).toBe('123.456');
    expect(mockResponseManager.startNewMessageWithPlaceholder).toHaveBeenCalledWith('_thinking..._');
    expect(mockWebClient.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'C123',
        thread_ts: '123.456',
        text: expect.stringContaining('Semantic search for "test query"'),
      }),
    );
    expect(mockResponseManager.finalizeMessage).toHaveBeenCalled();
  });
});
