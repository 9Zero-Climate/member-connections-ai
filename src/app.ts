import { App, Assistant, LogLevel } from '@slack/bolt';
import type { ChatPostMessageResponse, WebClient } from '@slack/web-api';
import { config } from 'dotenv';
import express from 'express';
import type { Express } from 'express';
import { OpenAI } from 'openai';
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionChunk,
  ChatCompletionMessage,
  ChatCompletionSystemMessageParam,
  ChatCompletionTool,
  ChatCompletionToolMessageParam,
  ChatCompletionUserMessageParam,
} from 'openai/resources/chat';
import { objectToXml, toolImplementations, tools } from './services/tools';

config();

// Setup Slack Bolt App
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  logLevel: LogLevel.DEBUG,
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
const PORT = process.env.PORT || 8080;
expressApp.listen(PORT, () => {
  app.logger.info(`Health check server listening on port ${PORT}`);
});

/** OpenRouter Setup */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  // TODO #20: Uncomment this when we have a paid OpenRouter account
  // apiKey: process.env.OPENROUTER_API_KEY,
  // baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': process.env.APP_URL || 'https://github.com/9Zero-Climate/member-connections-ai',
    'X-Title': 'Member Connections AI',
  },
});

const DEFAULT_SYSTEM_CONTENT = `You're an assistant in the Slack workspace for 9Zero Climate, a community of people working to end the climate crisis.
Users in the workspace will ask you to connect them with other members.
You'll respond to those questions in a professional way.

You have access to a search tool that can find relevant messages based on semantic similarity.
When a user asks a question, you should:

1. Analyze their question to determine what information they need
2. Use the search tool to find relevant messages, applying appropriate filters if needed
3. Format the results in a clear and helpful way
4. If needed, ask follow-up questions to clarify their needs

When formatting your responses:
1. Use Slack's markdown syntax:
   - Use *text* for bold
   - Use _text_ for italics
   - Use \`text\` for code blocks
   - Use \`\`\` for multi-line code blocks
   - Use > for blockquotes
   - Use • or - for bullet points, with a single space between the bullet and the text
   - Use 1. for numbered lists

2. When mentioning members:
   - Always use the <@USER_ID> format for member mentions when you have Slack IDs. When you do this, never mention the member's name explicitly alongside the <@USER_ID> since Slack will automatically show a tile with the member's name.
   - Never URLencode or escape the <@USER_ID> format. Use literal < and > characters.

3. When referencing messages:
   - Always include the permalink URL from the message metadata to create clickable links
   - Format links as <URL|text> where URL is the permalink and text is a brief description. Do not escape the brackets.
   - Example: <@USER_ID> mentioned <https://slack.com/archives/C1234567890/p1234567890123456|here> that[...]

You have access to relevant context from previous conversations and messages in the workspace - only information that is available to all 9Zero Climate members.
Use this context to provide more accurate and helpful responses.
If the context doesn't contain relevant information, say so and provide general guidance.`;

// Slack has a limit of 4000 characters per message
const MAX_MESSAGE_LENGTH = 3900;
const MAX_TOOL_CALL_ITERATIONS = 3;

interface UpdateMessageParams {
  client: WebClient;
  message: ChatPostMessageResponse;
  text: string;
}

const updateMessage = async ({ client, message, text }: UpdateMessageParams): Promise<void> => {
  if (!message.channel || !message.ts) {
    throw new Error(`Failed to get channel or timestamp from response message: ${JSON.stringify(message)}`);
  }

  // Ensure we always have some text content
  const messageText = text || '_thinking..._';

  await client.chat.update({
    channel: message.channel,
    ts: message.ts,
    text: messageText,
    parse: 'full',
  });
};

interface AssistantPrompt {
  title: string;
  message: string;
}

type ChatMessage =
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
}

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

const assistant = new Assistant({
  threadStarted: async ({ event, logger, say, setSuggestedPrompts, saveThreadContext }) => {
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
      logger.error(e);
    }
  },

  threadContextChanged: async ({ logger, saveThreadContext }) => {
    try {
      await saveThreadContext();
    } catch (e) {
      logger.error(e);
    }
  },

  userMessage: async ({ message: slackMessage, logger, say, setTitle, client }) => {
    const { channel: slackChannel, thread_ts, text, ts: userSlackMessageTs } = slackMessage as SlackMessage;
    let currentResponseText = '';
    let mainSlackResponseMessage: ChatPostMessageResponse;

    let lastUpdateTime = Date.now();
    const UPDATE_INTERVAL = 500; // 0.5 seconds

    await setTitle(text);

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

      const llmThread: ChatMessage[] = [
        { role: 'system', content: DEFAULT_SYSTEM_CONTENT },
        { role: 'system', content: 'Here is the conversation history:' },
        ...threadHistory,
        userMessage,
      ];

      // Tool calling loop
      // We don't want to let the LLM loop indefinitely, so we limit the number of tool calls
      let remainingLlmLoopsAllowed = MAX_TOOL_CALL_ITERATIONS;
      while (remainingLlmLoopsAllowed > 0) {
        mainSlackResponseMessage = await say({
          text: '_thinking..._',
          parse: 'full',
        });
        currentResponseText = '';
        remainingLlmLoopsAllowed--;

        // Get response from OpenRouter with tool calling enabled
        const streamFromLlm = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: llmThread,
          tools: tools as ChatCompletionTool[],
          tool_choice: remainingLlmLoopsAllowed > 0 ? 'auto' : 'none',
          stream: true,
          max_tokens: MAX_MESSAGE_LENGTH / 4,
        });

        // Process the stream
        const toolCalls: ToolCall[] = [];
        for await (const chunk of streamFromLlm) {
          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          // Handle content streaming: immediately update the chat message
          if (delta.content) {
            currentResponseText += delta.content;

            // Update periodically to avoid rate limiting
            if (Date.now() - lastUpdateTime > UPDATE_INTERVAL) {
              await updateMessage({
                client,
                message: mainSlackResponseMessage,
                text: currentResponseText,
              });
              lastUpdateTime = Date.now();
            }
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
            remainingLlmLoopsAllowed = 0;
          }
        }
        // Update message with final chunk
        await updateMessage({
          client,
          message: mainSlackResponseMessage,
          text: currentResponseText,
        });

        // LLM stream is done, we have the complete message
        // If we have tool calls, execute them
        if (toolCalls.length > 0) {
          mainSlackResponseMessage = await say({
            text: '_collecting data..._',
            parse: 'full',
          });

          llmThread.push({
            role: 'assistant',
            tool_calls: toolCalls,
          });
          for (const toolCall of toolCalls) {
            const toolName = toolCall.function.name;
            const toolArgs = JSON.parse(toolCall.function.arguments);
            const toolCallResult = await toolImplementations[toolName as keyof typeof toolImplementations](toolArgs);
            llmThread.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: objectToXml(toolCallResult),
            });
          }
        }
        llmThread.push({
          role: 'assistant',
          content: currentResponseText,
        });
      }
    } catch (e) {
      logger.error(e);

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
  app.logger.info('⚡️ Bolt app is running!');
})();
