import type { AssistantUserMessageMiddleware, AssistantUserMessageMiddlewareArgs } from '@slack/bolt/dist/Assistant';
import type { WebClient } from '@slack/web-api';
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

interface SlackMessage {
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

interface UserInfo {
  slack_ID: string;
  preferred_name?: string;
  real_name?: string;
  time_zone?: string;
  time_zone_offset?: number;
  error?: string;
  source?: string;
}

/**
 * Factory function for a user message handler.
 * Handles a user message from Slack, managing an agentic LLM loop to generate response message(s) and post them to the source channel.
 *
 * @param llmClient - An OpenAI-compatible LLM client.
 * @param client - The Slack client.
 * @returns The user message handler.
 */
export function getUserMessageHandler(llmClient: OpenAI, client: WebClient): AssistantUserMessageMiddleware {
  const handleUserMessage = async ({ message: slackMessage, say }: AssistantUserMessageMiddlewareArgs) => {
    const { channel: slackChannel, thread_ts, text, ts: userSlackMessageTs } = slackMessage as SlackMessage;
    const responseManager = new ResponseManager({ client, say });

    if (!text) {
      logger.warn({ msg: 'Received message without text', slackMessage });
      return;
    }

    logger.info({
      msg: 'Handling message from user',
      messageText: text,
      fullSlackMessage: slackMessage,
      triggeringMessageTs: userSlackMessageTs,
    });

    await client.reactions.add({
      name: 'thinking_face',
      channel: slackChannel,
      timestamp: userSlackMessageTs,
    });

    try {
      const slackThread = thread_ts
        ? await client.conversations.replies({
            channel: slackChannel,
            ts: thread_ts,
          })
        : { messages: [], ok: true };

      if (!slackThread.ok || !slackThread.messages) {
        throw new Error(`Failed to fetch thread replies: ${slackThread.error || 'Unknown error'}`);
      }

      const userMessage: ChatCompletionUserMessageParam = { role: 'user', content: text };
      const threadHistory = slackThread.messages
        .filter((m) => m?.ts !== userSlackMessageTs && typeof m?.text === 'string')
        .map((m): ChatMessage | null => {
          const role = m?.bot_id ? 'assistant' : 'user';
          const messageText = m?.text ?? '';
          const metadata = m?.metadata;
          const eventPayload = metadata?.event_payload as {
            tool_call_id?: string;
            tool_calls?: ChatCompletionMessageToolCall[];
          };

          if (metadata?.event_type === 'slack_tool_result') {
            return {
              role: 'tool',
              tool_call_id: eventPayload?.tool_call_id,
              content: messageText,
            } as ChatCompletionToolMessageParam;
          }
          if (m?.bot_id && eventPayload?.tool_calls) {
            return {
              role: 'assistant',
              content: messageText,
              tool_calls: eventPayload.tool_calls,
            };
          }
          if (messageText) {
            return { role, content: messageText } as ChatMessage;
          }
          return null;
        })
        .filter((m): m is ChatMessage => m !== null);

      let userInfoForBot: UserInfo;
      if (slackMessage.subtype === undefined && slackMessage.user) {
        try {
          const userRes = await client.users.info({ user: slackMessage.user });
          if (userRes.ok && userRes.user) {
            const user = userRes.user;
            const userProfile = user.profile;
            userInfoForBot = {
              slack_ID: `<@${slackMessage.user}>`,
              preferred_name: userProfile?.display_name || userProfile?.real_name_normalized,
              real_name: userProfile?.real_name,
              time_zone: user.tz,
              time_zone_offset: user.tz_offset,
            };
          } else {
            logger.warn({ msg: 'Could not fetch user info', userId: slackMessage.user, error: userRes.error });
            userInfoForBot = { slack_ID: `<@${slackMessage.user}>`, error: 'Could not fetch user info' };
          }
        } catch (e) {
          logger.error({ msg: 'Error fetching user info', userId: slackMessage.user, error: e });
          userInfoForBot = { slack_ID: `<@${slackMessage.user}>`, error: 'Exception fetching user info' };
        }
      } else {
        userInfoForBot = {
          slack_ID: 'SystemEvent',
          source: `a system event (${slackMessage.subtype || 'unknown'})`,
        };
      }

      const llmThread: ChatMessage[] = [
        { role: 'system', content: DEFAULT_SYSTEM_CONTENT },
        {
          role: 'system',
          content: `The current date and time is ${new Date().toISOString()}.`,
        },
        { role: 'system', content: 'Here is the conversation history:' },
        ...threadHistory,
        {
          role: 'system',
          content:
            slackMessage.subtype === undefined && slackMessage.user
              ? `The following message is from: ${JSON.stringify(userInfoForBot)}`
              : `The following message is from ${userInfoForBot.source || 'an unknown source'}.`,
        },
        userMessage,
      ];
      logger.debug({
        msg: 'LLM thread prepared',
        threadLength: llmThread.length,
      });

      let remainingLlmLoopsAllowed = config.maxToolCallIterations;

      while (remainingLlmLoopsAllowed > 0) {
        remainingLlmLoopsAllowed--;
        responseManager.startNewMessageWithPlaceholder('_thinking..._');

        const streamFromLlm = await llmClient.chat.completions.create({
          model: config.modelName,
          messages: llmThread,
          tools: tools as ChatCompletionTool[],
          // On the last loop, don't allow tool calls
          tool_choice: remainingLlmLoopsAllowed === 0 ? 'none' : 'auto',
          stream: true,
        });

        const toolCalls: ToolCall[] = [];

        for await (const chunk of streamFromLlm) {
          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          // Handle content streaming: immediately update the chat message, within limits
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

        const responseText = await responseManager.finalizeMessage();
        logger.debug({ msg: 'Finalized response text', responseText, triggeringMessageTs: userSlackMessageTs });
        if (responseText) {
          llmThread.push({
            role: 'assistant',
            content: responseText,
          });
        }

        const validToolCalls = toolCalls.filter((tc) => tc?.id && tc?.function?.name);
        if (validToolCalls.length === 0) {
          logger.info({ msg: 'LLM finished without tool calls in this loop.' });
          break;
        }

        const toolCallDescriptions = validToolCalls.map(getToolCallShortDescription).join(', ');

        // Bypass response manager for this message because we want to show the tool call descriptions as a standalone message
        await say({
          text: `_${toolCallDescriptions}..._`,
          parse: 'full',
        });

        // Actually do the tool calls
        const toolResultMessages = await executeToolCalls(validToolCalls, toolImplementations);
        llmThread.push(...toolResultMessages);
      }

      if (remainingLlmLoopsAllowed <= 0) {
        logger.warn({ msg: 'Reached max tool call iterations.', triggeringMessageTs: userSlackMessageTs });
      }
    } catch (e) {
      logger.error({
        msg: 'Error in user message handler',
        triggeringMessageTs: userSlackMessageTs,
        err: e instanceof Error ? { message: e.message, stack: e.stack } : e,
      });
      await say({
        text: `Sorry, something went wrong.\n You may want to forward this error message to an admin:
          \`\`\`\n${JSON.stringify(e, null, 2)}\n\`\`\``,
      });
    } finally {
      await client.reactions
        .remove({
          name: 'thinking_face',
          channel: slackChannel,
          timestamp: userSlackMessageTs,
        })
        .catch((e: unknown) => logger.error({ error: e }, 'Failed to remove reaction'));
    }
  };

  return handleUserMessage;
}
