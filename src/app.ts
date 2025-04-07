import { App, Assistant, LogLevel, type SayFn } from '@slack/bolt';
import type { ChatPostMessageResponse, WebClient } from '@slack/web-api';
import express from 'express';
import type { Express } from 'express';
import { OpenAI } from 'openai';
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionSystemMessageParam,
  ChatCompletionTool,
  ChatCompletionToolMessageParam,
  ChatCompletionUserMessageParam,
} from 'openai/resources/chat';
import ResponseManager from './assistant/ResponseManager';
import executeToolCalls from './assistant/executeToolCalls';
import { DEFAULT_SYSTEM_CONTENT } from './assistant/constants';
import { config } from './config';
import { boltLogger, logger } from './services/logger';
import { type ToolCall, getToolCallShortDescription, objectToXml, toolImplementations, tools } from './services/tools';

interface AssistantPrompt {
  title: string;
  message: string;
}

export type ChatMessage =
  | ChatCompletionSystemMessageParam
  | ChatCompletionUserMessageParam
  | ChatCompletionAssistantMessageParam
  | ChatCompletionToolMessageParam;

interface SlackMessage {
  channel: string;
  thread_ts?: string;
  text: string;
  ts: string;
  bot_id?: string;
  user?: string;
  subtype?: string;
}

// Setup Slack Bolt App
const app = new App({
  token: config.slackBotToken,
  appToken: config.slackAppToken,
  socketMode: true,
  logger: boltLogger,
});

// Create an Express app for health checks
const expressApp: Express = express();

// Health check endpoint
expressApp.get('/', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Start the Express server
expressApp.listen(config.port, () => {
  logger.info({ msg: 'Health check server started', port: config.port });
});

/** OpenRouter Setup */
const openai = new OpenAI({
  apiKey: config.openRouterApiKey,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': config.appUrl,
    'X-Title': 'Member Connections AI',
  },
});

// Slack has a limit of 4000 characters per message
const MAX_MESSAGE_LENGTH = config.maxMessageLength;
const MAX_TOOL_CALL_ITERATIONS = config.maxToolCallIterations;

const assistant = new Assistant({
  threadStarted: async ({ event, say, setSuggestedPrompts, saveThreadContext }) => {
    const { context } = event.assistant_thread;

    try {
      await say('Hi, how can I help?');

      await saveThreadContext();

      const prompts: [AssistantPrompt, ...AssistantPrompt[]] = [
        {
          title: 'Find experts in a particular field',
          message: 'Do we have any experts in distributed generation?',
        },
      ];

      // If the user opens the Assistant container in a channel, additional
      // context is available.This can be used to provide conditional prompts
      // that only make sense to appear in that context (like summarizing a channel).
      if (context.channel_id) {
        prompts.push({
          title: 'Summarize channel',
          message: 'Assistant, please summarize the activity in this channel!',
        });
      }

      await setSuggestedPrompts({ prompts });
    } catch (e) {
      logger.error(
        {
          error: e,
          event: 'thread_started',
          context: event.assistant_thread.context,
        },
        'Error in thread started handler',
      );

      await say({
        text: `Sorry, something went wrong.\n You may want to forward this error message to an admin:
              \`\`\`\n${JSON.stringify(e, null, 2)}\n\`\`\``,
      });
    }
  },

  threadContextChanged: async ({ logger, saveThreadContext }) => {
    try {
      await saveThreadContext();
    } catch (e) {
      logger.error({ err: e }, 'Error in thread context changed handler');
    }
  },

  userMessage: async ({ message: slackMessage, say, setTitle, client }) => {
    const { channel: slackChannel, thread_ts, text, ts: userSlackMessageTs } = slackMessage as SlackMessage;
    const responseManager = new ResponseManager({ client, say });

    await setTitle(text);

    logger.info({
      msg: 'Handling message from user',
      messageText: text,
      fullSlackMessage: slackMessage,
      triggeringMessageTs: userSlackMessageTs,
    });

    // Add thinking reaction to the original message
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
            oldest: thread_ts,
          })
        : { messages: [] };

      // Prepare messages for the LLM
      const userMessage: ChatCompletionUserMessageParam = { role: 'user', content: text };
      const threadHistory = (slackThread.messages || []).map((m) => {
        const role = m.bot_id ? 'assistant' : 'user';
        return { role, content: m.text } as ChatMessage;
      });

      // Get user info if message is from a user
      let userInfoForBot = {};
      if (slackMessage.subtype === undefined && slackMessage.user) {
        const user = (await client.users.info({ user: slackMessage.user })).user;
        const userProfile = user?.profile;
        userInfoForBot = {
          slack_ID: `<@${slackMessage.user}>`,
          preferred_name: userProfile?.display_name,
          real_name: userProfile?.real_name,
          time_zone: user?.tz,
          time_zone_offset: user?.tz_offset,
        };
      } else {
        userInfoForBot = {
          source: 'a system event',
        };
      }

      const llmThread: ChatMessage[] = [
        { role: 'system', content: DEFAULT_SYSTEM_CONTENT },
        {
          role: 'system',
          content: `The current date and time is ${new Date()}.`,
        },
        { role: 'system', content: 'Here is the conversation history:' },
        ...threadHistory.slice(0, -1), // Remove the last message from the thread history- the user message is below:
        {
          role: 'system',
          content:
            slackMessage.subtype === undefined && slackMessage.user
              ? `The following message is from: ${JSON.stringify(userInfoForBot)}`
              : 'The following message is from a system event.',
        },
        userMessage,
      ];
      logger.debug({
        msg: 'LLM thread prepared',
        llmThread,
      });

      let remainingLlmLoopsAllowed = MAX_TOOL_CALL_ITERATIONS;
      while (remainingLlmLoopsAllowed > 0) {
        let currentResponseText = '';
        remainingLlmLoopsAllowed--;

        const streamFromLlm = await openai.chat.completions.create({
          model: 'google/gemini-2.0-flash-001',
          messages: llmThread,
          tools: tools as ChatCompletionTool[],
          tool_choice: remainingLlmLoopsAllowed > 0 ? 'auto' : 'none',
          stream: true,
          max_tokens: MAX_MESSAGE_LENGTH / 4,
        });

        const toolCalls: ToolCall[] = [];
        for await (const chunk of streamFromLlm) {
          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          // Handle content streaming: immediately update the chat message, within limits
          if (delta.content) {
            currentResponseText += delta.content;
            await responseManager.updateMessage(currentResponseText);
          }

          // Handle tool calls: buffer them until we have the complete set
          if (delta.tool_calls) {
            for (const toolCall of delta.tool_calls) {
              if (toolCall.index === undefined) continue;

              // Initialize or update tool call
              if (!toolCalls[toolCall.index]) {
                toolCalls[toolCall.index] = {
                  id: toolCall.id || '',
                  type: 'function',
                  function: {
                    name: toolCall.function?.name || '',
                    arguments: toolCall.function?.arguments || '',
                  },
                };
              } else {
                // Update existing tool call
                if (toolCall.function?.name) {
                  toolCalls[toolCall.index].function.name = toolCall.function.name;
                }
                if (toolCall.function?.arguments) {
                  toolCalls[toolCall.index].function.arguments += toolCall.function.arguments;
                }
              }
            }
          }

          if (chunk.choices[0]?.finish_reason === 'stop') {
            // Break the loop if the LLM decides to stop
            remainingLlmLoopsAllowed = 0;
          }
        }

        await responseManager.finalizeMessage();
        if (currentResponseText) {
          llmThread.push({
            role: 'assistant',
            content: currentResponseText,
          });
        }

        if (toolCalls.length > 0) {
          // Add assistant message indicating tool use to thread
          llmThread.push({
            role: 'assistant',
            tool_calls: toolCalls,
          });

          const toolCallDescriptions = toolCalls.map(getToolCallShortDescription).join(', ');

          // we're intentionally not updating the response manager here because we want to show the tool call descriptions as a standalone message
          await say({
            text: `_${toolCallDescriptions}..._`,
            parse: 'full',
          });

          // Execute tools and get result messages
          const toolResultMessages = await executeToolCalls(toolCalls);

          // Add tool results to the thread
          llmThread.push(...toolResultMessages);
        }
      }
    } catch (e) {
      logger.error({ err: e }, 'Error in user message handler');

      await say({
        text: `Sorry, something went wrong.\n You may want to forward this error message to an admin:
              \`\`\`\n${JSON.stringify(e, null, 2)}\n\`\`\``,
      });
    } finally {
      await client.reactions.remove({
        name: 'thinking_face',
        channel: slackChannel,
        timestamp: userSlackMessageTs,
      });
    }
  },
});

// Register the assistant with the Slack app
app.assistant(assistant);

// Start the Slack app
(async () => {
  await app.start();
  logger.info({
    msg: '⚡️ Bolt app started',
    env: process.env.NODE_ENV,
    socketMode: true,
  });
})();
