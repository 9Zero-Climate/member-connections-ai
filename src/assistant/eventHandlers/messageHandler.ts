import type { SlackEventMiddlewareArgs } from '@slack/bolt/dist/types/events';
import type { ConversationsRepliesResponse, MessageEvent, WebClient } from '@slack/web-api';
import type { OpenAI } from 'openai';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { config } from '../../config';
import { logger } from '../../services/logger';
import type { SlackMessage } from '../initialLlmThread';
import { handleIncomingMessage } from '../llmConversation';
import { convertSlackHistoryToLLMHistory } from '../messagePacking';
import { BASIC_ASSISTANT_DESCRIPTION } from '../prompts';
import { fetchSlackThreadAndChannelContext, getBotUserId } from '../slackInteraction';

export type ThreadMessage = MessageEvent & { thread_ts: string };
export enum ConditionalResponse {
  IGNORE = 0,
  RESPOND = 1,
  RESPOND_IF_DIRECTED_AT_US = 2,
}
const IGNORED_SUBTYPES = ['bot_message', 'message_changed', 'message_deleted'];
/* General heuristic:
 * We should respond to messages matching one of the following:
 * - We are directly @mentioned (handled in app_mention handler, not here)
 * - Message is from a user in their DM thread (in which case we should always respond)
 * - Message is in a thread where we've responded before, AND the message is a follow-up directed at us, even if we're not @mentioned specifically.
 * Also,
 * - Message must be a "normal" message, not an edit, a bot message, etc.
 */
export const shouldRespondToMessage = async (
  slackMessage: MessageEvent,
  client: WebClient,
): Promise<ConditionalResponse> => {
  // There are all kinds of message events we don't care about such as channel_join
  const isMessage = slackMessage.type === 'message';
  const isIgnoredSubtype = slackMessage.subtype && IGNORED_SUBTYPES.includes(slackMessage.subtype);
  if (!isMessage || isIgnoredSubtype) {
    logger.info({ messageType: slackMessage.type, subtype: slackMessage.subtype }, 'Skipping unqualified message');
    return ConditionalResponse.IGNORE;
  }

  const checkIsInThread = (slackMessage: MessageEvent): slackMessage is ThreadMessage => 'thread_ts' in slackMessage;
  if (!checkIsInThread(slackMessage)) {
    logger.info({ messageType: slackMessage.type, subtype: slackMessage.subtype }, 'Skipping non-thread message');
    return ConditionalResponse.IGNORE;
  }

  const isInDm = slackMessage.channel_type === 'im';
  if (isInDm) {
    logger.info('Handling DM');
    return ConditionalResponse.RESPOND;
  }

  const threadContents = await client.conversations.replies({
    channel: slackMessage.channel,
    ts: slackMessage.thread_ts,
  });
  const botId = await getBotUserId(client);

  if (!wePreviouslyParticipatedInThread(threadContents, botId)) {
    logger.info({ threadContents, botId }, 'We did not previously participate in this thread, skipping');
    return ConditionalResponse.IGNORE;
  }

  return ConditionalResponse.RESPOND_IF_DIRECTED_AT_US;
};

export const wePreviouslyParticipatedInThread = (
  threadContents: ConversationsRepliesResponse,
  botId: string,
): boolean => {
  if (!threadContents.messages) {
    throw new Error('No messages in thread');
  }

  const wePreviouslyParticipatedInThread = threadContents.messages.some((message) => message.bot_id === botId);
  return wePreviouslyParticipatedInThread;
};

const toolShouldRespond: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'should_respond',
    description: 'Determine if the last message in the thread requires a response from the assistant.',
    parameters: {
      type: 'object',
      properties: {
        reasoning: {
          type: 'string',
          description: 'A short explanation of the reasoning for why the Fabric assistant should respond or not.',
        },
        assistant_should_respond: {
          type: 'boolean',
          description: 'True if the last message requires a response from the assistant.',
        },
      },
      required: ['assistant_should_respond', 'reasoning'],
    },
  },
};

/**
 * Uses an LLM call to determine if the latest message in a thread seems directed at the bot.
 */
export const isDirectedAtUs = async (
  slackMessage: MessageEvent & { thread_ts: string },
  client: WebClient,
  llmClient: OpenAI,
): Promise<boolean> => {
  logger.info({ slackMessage }, 'Using LLM to determine if message is directed at us');
  const threadMessages = await fetchSlackThreadAndChannelContext(client, slackMessage.channel, slackMessage.thread_ts);
  if (!threadMessages) {
    throw new Error(`No messages in thread for message ts ${slackMessage.ts}`);
  }
  const llmHistory = convertSlackHistoryToLLMHistory(threadMessages, slackMessage.ts);
  const messagesForLlm = [
    {
      role: 'system',
      content: `You are an orchestration agent for an AI assistant.
      Here is a blurb about the assistant:
      <assistant_description>
      ${BASIC_ASSISTANT_DESCRIPTION}
      </assistant_description>. Given that role and abilities, and the thread history, analyze the *last* message in the provided history. Based on the conversation context and the content of the last message, determine if it is directed at the assistant or requires the assistant to respond.
      Call the '${toolShouldRespond.function.name}' tool with the result.`,
    },
    ...llmHistory,
  ];

  const llmResponse = await llmClient.chat.completions.create({
    model: config.modelName,
    messages: messagesForLlm as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    tools: [toolShouldRespond],
    tool_choice: { type: 'function', function: { name: toolShouldRespond.function.name } },
    temperature: 0.1, // Low temperature for deterministic classification
  });

  const toolCall = llmResponse.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall?.function?.name !== toolShouldRespond.function.name) {
    logger.fatal({ messagesForLlm, llmResponse }, 'Required tool call missing from LLM response');
    throw new Error('No tool call in LLM response');
  }

  const args = JSON.parse(toolCall.function.arguments);
  const shouldRespond = Boolean(args.assistant_should_respond);
  logger.info(
    { messagesForLlm: messagesForLlm.length, llmResponse: llmResponse.choices[0], shouldRespond },
    'LLM classified message directionality',
  );
  return shouldRespond;
};

/**
 * Handles a message from Slack by calling the central message processing orchestrator if appropriate.
 */
export const handleGenericMessage = async (
  llmClient: OpenAI,
  client: WebClient,
  args: SlackEventMiddlewareArgs<'message'>,
) => {
  const { message: slackMessage, say } = args;

  logger.info({ slackMessage }, 'Handling generic message');

  const responseCondition = await shouldRespondToMessage(slackMessage, client);
  if (
    responseCondition === ConditionalResponse.RESPOND ||
    (responseCondition === ConditionalResponse.RESPOND_IF_DIRECTED_AT_US &&
      (await isDirectedAtUs(slackMessage as ThreadMessage, client, llmClient)))
  ) {
    await handleIncomingMessage({
      llmClient,
      client,
      slackMessage: slackMessage as SlackMessage,
      say,
      includeChannelContext: true,
    });
  } else {
    logger.info({ responseCondition }, 'Response condition not met, ignoring message.');
  }
};
