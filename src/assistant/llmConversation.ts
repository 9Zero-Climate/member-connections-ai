import type { SayFn } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import type { OpenAI } from 'openai';
import { config } from '../config';
import { type LLMToolCall, getToolCallShortDescription, getToolImplementationsMap, getToolSpecs } from '../llmTools';
import { logger } from '../services/logger';
import ResponseManager from './ResponseManager';
import executeToolCalls from './executeToolCalls';
import { type SlackMessage, buildInitialLlmThread } from './initialLlmThread';
import { convertSlackHistoryForLLMContext, packToolCallInfoIntoSlackMessageMetadata } from './messagePacking';
import {
  addFeedbackHintReactions,
  fetchSlackThreadAndChannelContext,
  fetchSlackThreadMessages,
  fetchUserInfo,
  getBotIds,
} from './slackInteraction';
import type { ChatMessage } from './types';

type RunLlmConversationArgs = {
  llmClient: OpenAI;
  client: WebClient;
  responseManager: ResponseManager;
  initialLlmThread: ChatMessage[];
  slackChannel: string;
  triggeringMessageTs: string;
  userIsAdmin: boolean;
};

/**
 * Run the main LLM conversation loop, handling responses, streaming, and tool calls.
 * Return the timestamp of the last finalized assistant message, if any.
 */
export const runLlmConversation = async ({
  llmClient,
  client,
  responseManager,
  initialLlmThread,
  slackChannel,
  triggeringMessageTs,
  userIsAdmin,
}: RunLlmConversationArgs): Promise<string | undefined> => {
  const llmThread = [...initialLlmThread];
  let remainingLlmLoopsAllowed = config.maxToolCallIterations;
  let finalizedMessageTs: string | undefined;

  while (remainingLlmLoopsAllowed > 0) {
    logger.debug({ remainingLlmLoopsAllowed, threadLength: llmThread.length }, 'Tool call / response loop iteration');
    remainingLlmLoopsAllowed--;
    await responseManager.startNewMessageWithPlaceholder('_thinking..._');

    const toolSpecs = getToolSpecs(userIsAdmin);
    logger.debug({ model: config.modelName, messages: llmThread, toolSpecs }, 'Calling for chat completion');
    const streamFromLlm = await llmClient.chat.completions.create({
      model: config.modelName,
      messages: llmThread,
      tools: toolSpecs,
      tool_choice: remainingLlmLoopsAllowed === 0 ? 'none' : 'auto',
      stream: true,
    });

    const toolCalls: LLMToolCall[] = [];

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
      metadata: packToolCallInfoIntoSlackMessageMetadata(validToolCalls),
    });

    // Execute tools and add results to history
    const toolImplementations = getToolImplementationsMap({ slackClient: client, userIsAdmin });
    const toolCallAndResultMessages: ChatMessage[] = await executeToolCalls(validToolCalls, toolImplementations);
    llmThread.push(...toolCallAndResultMessages);
  }

  if (remainingLlmLoopsAllowed <= 0) {
    logger.warn({ triggeringMessageTs }, 'Reached max tool call iterations.');
  }

  return finalizedMessageTs;
};

// --- Main Orchestrator ---

export interface HandleIncomingMessageArgs {
  llmClient: OpenAI;
  client: WebClient;
  slackMessage: SlackMessage;
  say: SayFn;
  includeChannelContext: boolean;
}

/**
 * Orchestrates the handling of an incoming Slack message (user message or app mention).
 */
export const handleIncomingMessage = async ({
  llmClient,
  client,
  slackMessage,
  say,
  includeChannelContext,
}: HandleIncomingMessageArgs) => {
  const { channel: slackChannel, thread_ts, text, ts: triggeringMessageTs, user: userId, subtype } = slackMessage;

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

  await client.reactions.add({
    name: 'thinking_face',
    channel: slackChannel,
    timestamp: triggeringMessageTs,
  });

  try {
    if (!includeChannelContext && !thread_ts) {
      throw new Error(
        `Either thread_ts must be provided (was ${thread_ts}) or includeChannelContext must be true (was ${includeChannelContext}). Otherwise where would we get context from?`,
      );
    }
    const rawSlackMessages =
      includeChannelContext || !thread_ts
        ? await fetchSlackThreadAndChannelContext(client, slackChannel, thread_ts || triggeringMessageTs)
        : await fetchSlackThreadMessages(client, slackChannel, thread_ts);

    const slackMessagesForHistory = rawSlackMessages || [];
    logger.debug({ slackMessagesCount: slackMessagesForHistory.length }, 'Slack messages for history fetched');

    if (!userId) {
      throw new Error('handleIncomingMessage called without a userId for an expected user interaction event.');
    }

    const userInfo = await fetchUserInfo(client, userId);
    const botIds = await getBotIds(client);

    const conversationSummaryMessage = convertSlackHistoryForLLMContext(slackMessagesForHistory, botIds.botId);

    const initialLlmThread = buildInitialLlmThread(conversationSummaryMessage, userInfo, text, botIds);

    const finalizedMessageTs = await runLlmConversation({
      llmClient,
      client,
      responseManager,
      initialLlmThread,
      slackChannel,
      triggeringMessageTs: effectiveThreadTs,
      userIsAdmin: userInfo.is_admin || false,
    });

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
    await say({
      text: `Something went wrong processing that message.\n You may want to forward this error message to an admin:\n\`\`\`\n${
        e instanceof Error ? e.message : JSON.stringify(e)
      }\n\`\`\``,
      thread_ts: effectiveThreadTs,
    });
  } finally {
    await client.reactions
      .remove({
        name: 'thinking_face',
        channel: slackChannel,
        timestamp: triggeringMessageTs,
      })
      .catch((error: unknown) => logger.error(error, 'Failed to remove thinking_face reaction'));
  }
};
