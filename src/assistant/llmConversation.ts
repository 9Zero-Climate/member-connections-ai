import type { SayFn } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import type { OpenAI } from 'openai';
import { config } from '../config';
import { logger } from '../services/logger';
import { type ToolCall, getToolCallShortDescription, getToolImplementationsMap, getToolSpecs } from '../services/tools';
import ResponseManager from './ResponseManager';
import executeToolCalls from './executeToolCalls';
import { type SlackMessage, buildInitialLlmThread } from './initialLlmThread';
import { convertSlackHistoryToLLMHistory, packToolCallInfoIntoSlackMessageMetadata } from './messagePacking';
import { addFeedbackHintReactions, fetchSlackThreadAndChannelContext } from './slackInteraction';
import { fetchSlackThreadMessages } from './slackInteraction';
import { getBotId } from './slackInteraction';
import { fetchUserInfo } from './slackInteraction';
import type { ChatMessage } from './types';

/**
 * Run the main LLM conversation loop, handling responses, streaming, and tool calls.
 * Return the timestamp of the last finalized assistant message, if any.
 */
export const runLlmConversation = async (
  llmClient: OpenAI,
  client: WebClient,
  responseManager: ResponseManager,
  initialLlmThread: ChatMessage[],
  slackChannel: string,
  triggeringMessageTs: string, // Can be user message ts or app_mention ts
  userIsAdmin: boolean,
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
      tools: getToolSpecs(userIsAdmin),
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
    if (!includeChannelContext && !thread_ts) {
      throw new Error(
        `Either thread_ts must be provided (was ${thread_ts}) or includeChannelContext must be true (was ${includeChannelContext}). Otherwise where would we get context from?`,
      );
    }
    const rawSlackMessages =
      includeChannelContext || !thread_ts // !thread_ts here is a hack to satistfy the type checker
        ? await fetchSlackThreadAndChannelContext(client, slackChannel, thread_ts || triggeringMessageTs)
        : await fetchSlackThreadMessages(client, slackChannel, thread_ts);
    const slackMessages = rawSlackMessages as SlackMessage[];
    logger.debug({ slackMessages }, 'Slack messages fetched');

    if (!userId) {
      throw new Error('handleIncomingMessage called without a userId for an expected user interaction event.');
    }

    const userInfo = await fetchUserInfo(client, userId);
    const botUserId = await getBotId(client);
    const threadHistoryForLLM = convertSlackHistoryToLLMHistory(slackMessages, triggeringMessageTs);
    const initialLlmThread = buildInitialLlmThread(threadHistoryForLLM, userInfo, text, botUserId);

    const finalizedMessageTs = await runLlmConversation(
      llmClient,
      client,
      responseManager,
      initialLlmThread,
      slackChannel,
      effectiveThreadTs,
      userInfo.is_admin || false,
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
      .catch((error: unknown) => logger.error(error, 'Failed to remove thinking_face reaction'));
  }
};
