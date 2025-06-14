// --- Mocks ---
import { mockLoggerService } from '../../services/mocks';
jest.mock('../../services/logger', () => mockLoggerService);

import type { SlackEventMiddlewareArgs } from '@slack/bolt/dist/types/events';
import type { ConversationsRepliesResponse, MessageEvent, WebClient } from '@slack/web-api';
import type { OpenAI } from 'openai';
import * as llmConversation from '../llmConversation';
import * as slackInteraction from '../slackInteraction';
import {
  ConditionalResponse,
  type ThreadMessage,
  handleGenericMessage,
  isDirectedAtUs,
  shouldRespondToMessage,
  wePreviouslyParticipatedInThread,
} from './messageHandler';

jest.mock('../slackInteraction', () => ({
  getBotIds: jest.fn().mockResolvedValue({
    botId: 'B_BOT_ID',
    userId: 'U_BOT_USER_ID',
  }),
  fetchSlackThreadAndChannelContext: jest.fn().mockResolvedValue([
    { user: 'U123', ts: '123.456', text: 'Initial' },
    { bot_id: 'U_BOT_USER_ID', ts: '123.457', text: 'Bot reply' },
    { user: 'U123', ts: '123.459', text: 'is this for the bot?' },
  ]),
}));

jest.mock('../messagePacking', () => ({
  createConversationSummary: jest.fn().mockReturnValue('Mocked conversation summary'),
  convertSlackHistoryForLLMContext: jest.fn().mockReturnValue([
    { role: 'system', content: 'Mocked summary from convertSlackHistoryForLLMContext' },
    { role: 'user', content: 'Initial' },
    { role: 'assistant', content: 'Bot reply' },
    { role: 'user', content: 'is this for the bot?' },
  ]),
  packToolCallInfoIntoSlackMessageMetadata: jest.fn(),
}));

jest.mock('../llmConversation', () => ({
  handleIncomingMessage: jest.fn(),
}));

// --- Test Fixtures ---
const baseMessage: MessageEvent = {
  type: 'message',
  subtype: undefined,
  channel: 'C123',
  user: 'U123',
  text: 'Hello',
  ts: '123.456',
  team: 'T123',
  channel_type: 'channel',
  event_ts: '123.457',
  client_msg_id: 'test-msg-id',
};

const baseThreadMessage: ThreadMessage = {
  ...baseMessage,
  thread_ts: '123.456',
};

const mockWebClient = {
  slackApiUrl: 'https://slack.com/api/',
  retryConfig: {},
  requestQueue: [],
  axios: {},
  conversations: {
    replies: jest.fn(),
    history: jest.fn(),
  },
} as unknown as WebClient;

const mockLlmClient = {
  chat: {
    completions: {
      create: jest.fn(),
    },
  },
} as unknown as OpenAI;

// --- Helper Functions ---
const createMessageEvent = (overrides: Partial<MessageEvent> = {}): MessageEvent => {
  const base = { ...baseMessage };
  const merged = { ...base, ...overrides };
  return merged as MessageEvent;
};

const createThreadMessage = (overrides: Partial<ThreadMessage> = {}): ThreadMessage => {
  const base = { ...baseThreadMessage };
  const merged = { ...base, ...overrides };
  return merged as ThreadMessage;
};

const createMessageArgs = (message: MessageEvent): SlackEventMiddlewareArgs<'message'> => ({
  event: message,
  message: message,
  payload: message,
  say: jest.fn(),
  body: {
    token: 'test-token',
    team_id: 'T123',
    api_app_id: 'test-app',
    event: message,
    type: 'event_callback',
    event_id: 'test-event',
    event_time: 123,
    authorizations: [],
    is_ext_shared_channel: false,
  },
});

const createLlmResponse = (shouldRespond: boolean) => ({
  choices: [
    {
      message: {
        tool_calls: [
          {
            id: 'call_123',
            type: 'function',
            function: {
              name: 'should_respond',
              arguments: JSON.stringify({ assistant_should_respond: shouldRespond, reasoning: 'test' }),
            },
          },
        ],
      },
    },
  ],
});

// --- Test Cases ---
describe('messageHandler', () => {
  // Mock dependencies
  const mockLlmConversation = {
    handleIncomingMessage: jest.fn(),
  };

  const mockIsDirectedAtUs = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (slackInteraction.getBotIds as jest.Mock).mockResolvedValue({
      botId: 'B_BOT_ID',
      userId: 'U_BOT_USER_ID',
    });
    (mockWebClient.conversations.replies as jest.Mock).mockResolvedValue({
      ok: true,
      messages: [],
    });
    (mockWebClient.conversations.history as jest.Mock).mockResolvedValue({
      ok: true,
      messages: [],
    });
    (mockLlmClient.chat.completions.create as jest.Mock).mockResolvedValue(createLlmResponse(true));
  });

  describe('shouldRespondToMessage', () => {
    const testCases = [
      {
        name: 'returns IGNORE for ignored subtypes',
        message: createMessageEvent({ subtype: 'bot_message' }),
        expected: ConditionalResponse.IGNORE,
      },
      {
        name: 'returns IGNORE for messages not in a thread',
        message: createMessageEvent(),
        expected: ConditionalResponse.IGNORE,
      },
      {
        name: 'returns RESPOND for messages in a DM',
        message: createThreadMessage({ channel_type: 'im' }),
        expected: ConditionalResponse.RESPOND,
      },
    ];

    it.each(testCases)('$name', async ({ message, expected }) => {
      const result = await shouldRespondToMessage(message, mockWebClient);
      expect(result).toBe(expected);
    });

    it('returns IGNORE if message is in a thread we havent participated in', async () => {
      const message = createThreadMessage();
      (mockWebClient.conversations.replies as jest.Mock).mockResolvedValue({
        ok: true,
        messages: [
          { user: 'U123', ts: '123.456' },
          { user: 'U456', ts: '123.457' },
        ],
      });

      const result = await shouldRespondToMessage(message, mockWebClient);

      expect(result).toBe(ConditionalResponse.IGNORE);
      expect(mockWebClient.conversations.replies).toHaveBeenCalledWith({
        channel: message.channel,
        ts: message.thread_ts,
      });
    });

    it('returns RESPOND_IF_DIRECTED_AT_US if message is in a thread we participated in', async () => {
      const message = createThreadMessage();
      (mockWebClient.conversations.replies as jest.Mock).mockResolvedValue({
        ok: true,
        messages: [
          { user: 'U123', ts: '123.456' },
          { bot_id: 'B_BOT_ID', user: 'U_BOT_USER_ID', ts: '123.457' },
        ],
      });

      const result = await shouldRespondToMessage(message, mockWebClient);

      expect(result).toBe(ConditionalResponse.RESPOND_IF_DIRECTED_AT_US);
    });
  });

  describe('isDirectedAtUs', () => {
    const threadMessage = createThreadMessage({ text: 'is this for the bot?' });

    const directedAtUsTestCases = [
      {
        name: 'returns true when LLM indicates the message is directed at us',
        llmResponse: createLlmResponse(true),
        expected: true,
      },
      {
        name: 'returns false when LLM indicates the message is not directed at us',
        llmResponse: createLlmResponse(false),
        expected: false,
      },
    ];

    it.each(directedAtUsTestCases)('$name', async ({ llmResponse, expected }) => {
      (mockLlmClient.chat.completions.create as jest.Mock).mockResolvedValue(llmResponse);

      const result = await isDirectedAtUs(threadMessage, mockWebClient, mockLlmClient);

      expect(result).toBe(expected);
      expect(slackInteraction.fetchSlackThreadAndChannelContext).toHaveBeenCalledWith(
        mockWebClient,
        threadMessage.channel,
        threadMessage.thread_ts,
      );
    });
  });

  describe('handleGenericMessage', () => {
    type TestSpies = {
      shouldRespondToMessageSpy: jest.SpyInstance;
      isDirectedAtUsSpy?: jest.SpyInstance;
    };

    const testCases = [
      {
        name: 'calls handleIncomingMessage for DMs',
        message: createMessageEvent({ channel_type: 'im' }),
        setup: () => {
          const spy = jest
            .spyOn(require('./messageHandler'), 'shouldRespondToMessage')
            .mockResolvedValue(ConditionalResponse.RESPOND);
          return { shouldRespondToMessageSpy: spy };
        },
        assertions: (spies: TestSpies) => {
          expect(llmConversation.handleIncomingMessage).toHaveBeenCalled();
          expect(spies.shouldRespondToMessageSpy).toHaveBeenCalled();
        },
      },
      {
        name: 'does not call handleIncomingMessage for ignored message types',
        message: createMessageEvent({ subtype: 'bot_message' }),
        setup: () => {
          const spy = jest
            .spyOn(require('./messageHandler'), 'shouldRespondToMessage')
            .mockResolvedValue(ConditionalResponse.IGNORE);
          return { shouldRespondToMessageSpy: spy };
        },
        assertions: (spies: TestSpies) => {
          expect(llmConversation.handleIncomingMessage).not.toHaveBeenCalled();
          expect(spies.shouldRespondToMessageSpy).toHaveBeenCalled();
        },
      },
      {
        name: 'handles thread participation and directedness checks correctly',
        message: createThreadMessage(),
        setup: () => {
          const shouldRespondToMessageSpy = jest
            .spyOn(require('./messageHandler'), 'shouldRespondToMessage')
            .mockResolvedValue(ConditionalResponse.RESPOND_IF_DIRECTED_AT_US);
          const isDirectedAtUsSpy = jest.spyOn(require('./messageHandler'), 'isDirectedAtUs').mockResolvedValue(true);
          return { shouldRespondToMessageSpy, isDirectedAtUsSpy };
        },
        assertions: (spies: TestSpies) => {
          expect(llmConversation.handleIncomingMessage).toHaveBeenCalled();
          expect(spies.shouldRespondToMessageSpy).toHaveBeenCalled();
          expect(spies.isDirectedAtUsSpy).toHaveBeenCalled();
        },
      },
    ];

    beforeEach(() => {
      jest.clearAllMocks();
      jest.restoreAllMocks();
    });

    for (const { name, message, setup, assertions } of testCases) {
      it(name, async () => {
        const spies = setup();
        const args = createMessageArgs(message);
        await handleGenericMessage(mockLlmClient, mockWebClient, args);
        assertions(spies);
      });
    }
  });

  describe('wePreviouslyParticipatedInThread', () => {
    const botIds = {
      botId: 'U_BOT_ID',
      userId: 'U_BOT_USER_ID',
    };

    it('returns false when thread has no messages', () => {
      const threadContents = { ok: true } as ConversationsRepliesResponse;
      expect(wePreviouslyParticipatedInThread(threadContents, botIds)).toBe(false);
    });

    it.each([
      {
        expected: true,
        when: 'bot has previously participated, identified by bot_id and user id',
        messageOverrides: { bot_id: botIds.botId, user: botIds.userId, text: 'Bot reply' },
      },
      // In our observations, slack messages from bots have *both* bot_id and user fields set.
      // But I don't see a downside in checking for either one on its own as well.
      {
        expected: true,
        when: 'bot has previously participated, identified by bot_id',
        messageOverrides: { bot_id: botIds.botId, text: 'Bot reply' },
      },
      {
        expected: true,
        when: 'bot has previously participated, identified by bot user id',
        messageOverrides: { user: botIds.userId, text: 'Bot reply' },
      },
      {
        expected: false,
        when: 'bot has not previously participated',
        messageOverrides: { user: 'U123' },
      },
      {
        expected: false,
        when: 'other bot has participated',
        messageOverrides: { bot_id: 'OTHER_BOT_ID', text: 'Other bot reply' },
      },
    ])('returns $expected when $when', ({ messageOverrides, expected }) => {
      const threadContents = {
        ok: true,
        messages: [
          { user: 'U123', ts: '123.456', text: 'Initial' },
          { ts: '123.457', text: 'Another message', ...messageOverrides },
          { user: 'U123', ts: '123.459', text: 'Follow up' },
        ],
      } as ConversationsRepliesResponse;

      expect(wePreviouslyParticipatedInThread(threadContents, botIds)).toBe(expected);
    });
  });
});
