import { App, Assistant, LogLevel } from '@slack/bolt';
import type { ChatPostMessageResponse, WebClient } from '@slack/web-api';
import { config } from 'dotenv';
import express from 'express';
import type { Express } from 'express';
import { OpenAI } from 'openai';
import { formatDocsForContext, retrieveRelevantDocs } from './services/rag';

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
   - Format links as <URL|text> where URL is the permalink and text is a brief description
   - Example: <@USER_ID> mentioned <https://slack.com/archives/C1234567890/p1234567890123456|here> that[...]

You have access to relevant context from previous conversations and messages in the workspace - only information that is available to all 9Zero Climate members.
Use this context to provide more accurate and helpful responses.
If the context doesn't contain relevant information, say so and provide general guidance.`;

// Slack has a limit of 4000 characters per message
const MAX_MESSAGE_LENGTH = 3900;

interface UpdateMessageParams {
  client: WebClient;
  message: ChatPostMessageResponse;
  text: string;
}

const updateMessage = async ({ client, message, text }: UpdateMessageParams): Promise<void> => {
  if (!message.channel || !message.ts) {
    throw new Error(`Failed to get channel or timestamp from response message: ${JSON.stringify(message)}`);
  }

  await client.chat.update({
    channel: message.channel,
    ts: message.ts,
    text: text,
  });
};

interface AssistantPrompt {
  title: string;
  message: string;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface SlackMessage {
  channel: string;
  thread_ts?: string;
  text: string;
  ts: string;
  bot_id?: string;
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

  userMessage: async ({ message, logger, say, setTitle, setStatus, client }) => {
    const { channel, thread_ts, text, ts } = message as SlackMessage;
    let currentText = '';
    let responseMessage: ChatPostMessageResponse;

    let lastUpdateTime = Date.now();
    const UPDATE_INTERVAL = 500; // 0.5 seconds

    try {
      await setTitle(text);
      await setStatus('is typing..');

      // Add thinking reaction to the original message
      await client.reactions.add({
        name: 'thinking_face',
        channel: channel,
        timestamp: ts,
      });

      responseMessage = await say({
        text: '_thinking..._',
        parse: 'full',
      });
    } catch (e) {
      logger.error(e);
      throw new Error('Failed to set up response message');
    }

    try {
      // Retrieve the Assistant thread history for context of question being asked
      const thread = thread_ts
        ? await client.conversations.replies({
            channel,
            ts: thread_ts,
            oldest: thread_ts,
          })
        : { messages: [] };

      // Get relevant documents using RAG
      const relevantDocs = await retrieveRelevantDocs(text, { limit: 30 });
      const contextFromDocs = formatDocsForContext(relevantDocs);
      logger.debug(`Context from docs: ${contextFromDocs}`);

      // Prepare and tag each message for LLM processing
      const userMessage: ChatMessage = { role: 'user', content: text };
      const threadHistory = (thread.messages || []).map((m) => {
        const role = m.bot_id ? 'assistant' : 'user';
        return { role, content: m.text } as ChatMessage;
      });

      const messages: ChatMessage[] = [
        { role: 'system', content: DEFAULT_SYSTEM_CONTENT },
        {
          role: 'system',
          content:
            'Here is some relevant context from previous conversations. Each message includes metadata about the user who wrote it and the channel it was posted in. Use this information to mention users with their Slack IDs when appropriate:',
        },
        { role: 'user', content: contextFromDocs },
        { role: 'system', content: 'Here is the conversation history:' },
        ...threadHistory,
        userMessage,
      ];

      // Stream the response from OpenRouter
      const stream = await openai.chat.completions.create({
        // TODO #20: Uncomment this when we have a paid OpenRouter account
        // model: 'google/gemini-2.0-flash-001',
        model: 'gpt-4o-mini',
        messages,
        stream: true,
        max_tokens: MAX_MESSAGE_LENGTH / 4,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          currentText += content;

          // Rather than updating the message on every received chunk, throttle it to an interval
          // to avoid upsetting the Slack API.
          const now = Date.now();
          if (now - lastUpdateTime >= UPDATE_INTERVAL) {
            await updateMessage({
              client,
              message: responseMessage,
              text: currentText,
            });
            lastUpdateTime = now;
          }
        }
      }

      // Final update to ensure we have the complete message
      await updateMessage({
        client,
        message: responseMessage,
        text: currentText,
      });

      // Remove thinking reaction
      await client.reactions.remove({
        name: 'thinking_face',
        channel: message.channel,
        timestamp: message.ts,
      });
    } catch (e) {
      logger.error(e);

      // Make sure to remove the thinking reaction even if there's an error
      try {
        await client.reactions.remove({
          name: 'thinking_face',
          channel: message.channel,
          timestamp: message.ts,
        });
        await say({
          text: `Sorry, something went wrong.\n You may want to forward this error message to an admin: \`\`\`\n${JSON.stringify(e, null, 2)}\n\`\`\``,
        });
      } catch (reactionError) {
        logger.error('Failed to remove thinking reaction:', reactionError);
      }
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
