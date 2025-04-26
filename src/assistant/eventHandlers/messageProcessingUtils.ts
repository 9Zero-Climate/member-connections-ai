import type { SayFn } from '@slack/bolt';
import type { ConversationsRepliesResponse, WebClient } from '@slack/web-api';
import type { OpenAI } from 'openai';
import type {
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
  ChatCompletionToolMessageParam,
  ChatCompletionUserMessageParam,
} from 'openai/resources/chat';
import type { ChatMessage } from '..';
import { config } from '../../config';
import { logger } from '../../services/logger';
import { type ToolCall, getToolCallShortDescription, toolImplementations, tools } from '../../services/tools';
import ResponseManager from '../ResponseManager';
import { DEFAULT_SYSTEM_CONTENT } from '../constants';
import executeToolCalls from '../executeToolCalls';
import {
  convertSlackHistoryToLLMHistory as originalConvertHistory,
  packToolCallInfoIntoSlackMessageMetadata,
} from '../messagePacking';

export interface SlackMessage {
  channel: string;
  thread_ts?: string;
  text: string;
  ts: string;
  bot_id?: string;
  user?: string;
  subtype?: string;
  metadata?: {
    event_type?: string;
    event_payload?: { tool_call_id?: string; tool_calls?: ChatCompletionMessageToolCall[] };
  };
}

export interface UserInfo {
  slack_ID: string;
  preferred_name?: string;
  real_name?: string;
  time_zone?: string;
  time_zone_offset?: number;
  error?: string;
  source?: string;
}

// --- Helper Functions ---

/**
 * Fetches the replies in a Slack thread.
 */
export const fetchSlackThread = async (
  client: WebClient,
  channel: string,
  thread_ts: string | undefined,
): Promise<ConversationsRepliesResponse['messages']> => {
  if (!thread_ts) {
    return [];
  }
  const slackThread = await client.conversations.replies({
    channel: channel,
    ts: thread_ts,
    include_all_metadata: true,
  });
  logger.debug({ slackThread }, 'Slack thread fetched');

  if (!slackThread.ok || !slackThread.messages) {
    throw new Error(`Failed to fetch thread replies: ${slackThread.error || 'Unknown error'}`);
  }
  return slackThread.messages;
};

/**
 * Fetches information about a Slack user.
 */
export const fetchUserInfo = async (client: WebClient, userId: string): Promise<UserInfo> => {
  const userRes = await client.users.info({ user: userId });
  if (userRes.ok && userRes.user) {
    const user = userRes.user;
    const userProfile = user.profile;
    return {
      slack_ID: `<@${userId}>`,
      preferred_name: userProfile?.display_name || userProfile?.real_name_normalized,
      real_name: userProfile?.real_name,
      time_zone: user.tz,
      time_zone_offset: user.tz_offset,
    };
  }
  throw new Error(`Failed to fetch user info for ${userId}: ${userRes.error || 'Unknown error'}`);
};

/**
 * Converts Slack message history to the LLM chat format.
 * Prepends user messages with their Slack ID for multi-user context.
 */
export const convertSlackHistoryToLLMHistory = (
  slackMessages: SlackMessage[],
  currentUserMessageTs: string,
  botUserId?: string, // Needed to correctly identify assistant messages
): ChatMessage[] => {
  // Filter out the current message being processed and sort
  const relevantMessages = slackMessages
    .filter((msg) => msg.ts !== currentUserMessageTs)
    .sort((a, b) => Number.parseFloat(a.ts) - Number.parseFloat(b.ts)); // Ensure chronological order

  const history: ChatMessage[] = [];

  for (const message of relevantMessages) {
    const isBotMessage = message.bot_id !== undefined || message.metadata?.event_type === 'assistant_message'; // Adjust condition based on how bot messages are identified
    const isToolResponseMessage = message.metadata?.event_type === 'tool_result'; // Assume tool results are posted as bot messages with metadata

    if (isToolResponseMessage && message.metadata?.event_payload?.tool_call_id && message.text) {
      history.push({
        role: 'tool',
        tool_call_id: message.metadata.event_payload.tool_call_id,
        content: message.text,
      });
      // Potentially also add the assistant message that contained the tool *call* if it's stored separately
      // This depends on how packToolCallInfoIntoSlackMessageMetadata works and if the original assistant message text is preserved
      // For now, assuming the originalConvertHistory handled this correctly or it's packed elsewhere.
    } else if (isBotMessage && message.text) {
      // Check if this assistant message contained tool calls
      const toolCalls = message.metadata?.event_payload?.tool_calls;
      if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
        history.push({
          role: 'assistant',
          content: message.text || null, // Content can be null for tool calls
          tool_calls: toolCalls,
        });
      } else {
        // Regular assistant message
        history.push({ role: 'assistant', content: message.text });
      }
    } else if (message.user && message.text) {
      // User message: Prepend with user ID
      history.push({ role: 'user', content: `<@${message.user}>: ${message.text}` });
    }
    // Ignore messages without user/bot ID or text, or subtypes we don't handle
  }
  // Note: The original `convertSlackHistoryToLLMHistory` from messagePacking might need review
  // to ensure it correctly handles the metadata and tool calls/results separation.
  // This implementation makes assumptions based on the provided code.
  // We might need to adjust how botUserId is fetched and passed in.
  logger.debug({ historyLength: history.length }, 'Converted Slack history to LLM format');
  return history;
};

/**
 * Builds the initial message list for the LLM, including system prompts, history, and the current user message.
 */
export const buildInitialLlmThread = (
  history: ChatMessage[],
  userInfo: UserInfo,
  userMessageText: string,
  botUserId: string,
): ChatMessage[] => {
  const userMessage: ChatCompletionUserMessageParam = { role: 'user', content: userMessageText };

  const llmThread: ChatMessage[] = [
    { role: 'system', content: DEFAULT_SYSTEM_CONTENT },
    {
      role: 'system',
      content: `The current date and time is ${new Date().toISOString()} and your slack ID is ${botUserId}.`,
    },
    { role: 'system', content: 'Here is the conversation history (if any):' },
    ...history,
    {
      role: 'system',
      content: `The following message is from: ${JSON.stringify(userInfo)}`,
    },
    userMessage,
  ];
  logger.debug({ threadLength: llmThread.length, thread: llmThread }, 'LLM thread prepared');
  return llmThread;
};

/**
 * Runs the main LLM conversation loop, handling responses, streaming, and tool calls.
 * Returns the timestamp of the last finalized assistant message, if any.
 */
export const runLlmConversation = async (
  llmClient: OpenAI,
  client: WebClient,
  responseManager: ResponseManager,
  initialLlmThread: ChatMessage[],
  slackChannel: string,
  triggeringMessageTs: string, // Can be user message ts or app_mention ts
): Promise<string | undefined> => {
  const llmThread = [...initialLlmThread];
  let remainingLlmLoopsAllowed = config.maxToolCallIterations;
  let finalizedMessageTs: string | undefined;

  while (remainingLlmLoopsAllowed > 0) {
    logger.debug({ remainingLlmLoopsAllowed, threadLength: llmThread.length }, 'Tool call / response loop iteration');
    remainingLlmLoopsAllowed--;
    // Use thread_ts for subsequent messages in the loop to keep them threaded
    responseManager.startNewMessageWithPlaceholder('_thinking..._');

    const streamFromLlm = await llmClient.chat.completions.create({
      model: config.modelName,
      messages: llmThread,
      tools: tools as ChatCompletionTool[],
      tool_choice: remainingLlmLoopsAllowed === 0 ? 'none' : 'auto',
      stream: true,
    });

    const toolCalls: ToolCall[] = [];

    for await (const chunk of streamFromLlm) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        await responseManager.appendToMessage(delta.content);
      }

      // Handle tool calls: buffer them until we have the complete set
      if (delta.tool_calls) {
        for (const toolCallDelta of delta.tool_calls) {
          if (toolCallDelta.index === undefined) continue;
          const index = toolCallDelta.index;

          // Initialize or update tool call
          if (!toolCalls[index]) {
            toolCalls[index] = {
              id: toolCallDelta.id || '',
              type: 'function',
              function: {
                name: toolCallDelta.function?.name || '',
                arguments: toolCallDelta.function?.arguments || '',
              },
            };
          } else {
            // Tool call already buffered -> update with any new arguments
            if (toolCallDelta.function?.name) {
              toolCalls[index].function.name = toolCallDelta.function.name;
            }
            if (toolCallDelta.function?.arguments) {
              toolCalls[index].function.arguments += toolCallDelta.function.arguments;
            }
          }
        }
      }
    }

    // Finalize the response manager for this iteration
    const finalizedMessage = await responseManager.finalizeMessage();
    const responseText = finalizedMessage.text;
    logger.debug({ responseText, triggeringMessageTs }, 'Finalized response text for loop iteration');

    if (responseText) {
      llmThread.push({
        role: 'assistant',
        content: responseText,
      });
      finalizedMessageTs = finalizedMessage.ts;
    }

    const validToolCalls = toolCalls.filter((tc) => tc?.id && tc?.function?.name);
    if (validToolCalls.length === 0) {
      logger.info({ triggeringMessageTs }, 'LLM finished without tool calls in this loop.');
      break; // Exit loop if no tool calls
    }

    // Post message indicating tool use
    logger.debug({ validToolCalls }, 'Handling tool calls');
    const toolCallDescriptions = validToolCalls.map(getToolCallShortDescription).join(', ');
    // Post tool call marker as a separate message in the thread
    await client.chat.postMessage({
      channel: slackChannel,
      thread_ts: triggeringMessageTs, // Reply within the thread started by the trigger message
      text: `_${toolCallDescriptions}..._`,
      parse: 'full',
      metadata: packToolCallInfoIntoSlackMessageMetadata(validToolCalls),
    });

    // Execute tools and add results to history
    const toolCallAndResultMessages: ChatMessage[] = await executeToolCalls(validToolCalls, toolImplementations);
    llmThread.push(...toolCallAndResultMessages);
  }

  if (remainingLlmLoopsAllowed <= 0) {
    logger.warn({ triggeringMessageTs }, 'Reached max tool call iterations.');
  }

  return finalizedMessageTs;
};

/**
 * Adds +1/-1 reactions to a message to hint at the feedback flow.
 */
export const addFeedbackHintReactions = async (client: WebClient, channel: string, messageTs: string) => {
  logger.info({ messageTs: messageTs, channel }, 'Adding feedback reaction hints');
  try {
    await Promise.all([
      client.reactions.add({ name: '+1', channel: channel, timestamp: messageTs }),
      client.reactions.add({ name: '-1', channel: channel, timestamp: messageTs }),
    ]);
  } catch (error) {
    logger.error({ error, messageTs, channel }, 'Failed to add feedback hint reactions');
  }
};

// --- Main Orchestrator ---

export interface HandleIncomingMessageArgs {
  llmClient: OpenAI;
  client: WebClient;
  slackMessage: SlackMessage;
  say: SayFn;
}

/**
 * Gets the Bot User ID, fetching it via auth.test if necessary.
 */
const getBotUserId = async (client: WebClient): Promise<string> => {
  const authTest = await client.auth.test();
  if (authTest.ok && authTest.bot_id) {
    logger.info({ botUserId: authTest.bot_id }, 'Fetched bot user ID via auth.test');
    return authTest.bot_id;
  }
  throw new Error('Could not fetch bot user ID via auth.test');
};

/**
 * Orchestrates the handling of an incoming Slack message (user message or app mention).
 */
export const handleIncomingMessage = async ({ llmClient, client, slackMessage, say }: HandleIncomingMessageArgs) => {
  const { channel: slackChannel, thread_ts, text, ts: triggeringMessageTs, user: userId, subtype } = slackMessage;

  // Always use the triggering message's ts to start/continue a thread
  const effectiveThreadTs = triggeringMessageTs;
  const responseManager = new ResponseManager({ client, say, channelOrThreadTs: effectiveThreadTs });

  logger.info(
    {
      messageText: text,
      fullSlackMessage: slackMessage,
      triggeringMessageTs: triggeringMessageTs,
      user: userId,
      subtype: subtype,
    },
    'Handling incoming Slack message',
  );

  // Show the user that we are preparing to respond
  await client.reactions.add({
    name: 'thinking_face',
    channel: slackChannel,
    timestamp: triggeringMessageTs,
  });

  try {
    const rawSlackMessages = await fetchSlackThread(client, slackChannel, thread_ts);
    const slackMessages = rawSlackMessages as SlackMessage[];

    if (!userId) {
      throw new Error('handleIncomingMessage called without a userId for an expected user interaction event.');
    }

    const userInfo = await fetchUserInfo(client, userId);
    const botUserId = await getBotUserId(client);
    const threadHistoryForLLM = convertSlackHistoryToLLMHistory(slackMessages, triggeringMessageTs, botUserId);
    const initialLlmThread = buildInitialLlmThread(threadHistoryForLLM, userInfo, text, botUserId);

    const finalizedMessageTs = await runLlmConversation(
      llmClient,
      client,
      responseManager,
      initialLlmThread,
      slackChannel,
      effectiveThreadTs,
    );

    // Add feedback reactions if the conversation resulted in a final message
    if (finalizedMessageTs) {
      addFeedbackHintReactions(client, slackChannel, finalizedMessageTs);
    } else {
      logger.info(
        { triggeringMessageTs },
        'No final text message tracked by ResponseManager, skipping feedback reactions.',
      );
    }
  } catch (e) {
    logger.error(
      {
        triggeringMessageTs: triggeringMessageTs,
        err: e instanceof Error ? { message: e.message, stack: e.stack } : e,
      },
      'Error in message handler',
    );
    // Report the error
    await say({
      text: `Something went wrong processing that message.\n You may want to forward this error message to an admin:\n\`\`\`\n${
        e instanceof Error ? e.message : JSON.stringify(e)
      }\n\`\`\``,
      thread_ts: effectiveThreadTs,
    });
  } finally {
    // Remove reaction from the trigger message
    await client.reactions
      .remove({
        name: 'thinking_face',
        channel: slackChannel,
        timestamp: triggeringMessageTs,
      })
      .catch((err: unknown) => logger.error({ error: err }, 'Failed to remove thinking_face reaction'));
  }
};
