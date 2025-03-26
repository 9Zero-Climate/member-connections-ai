const { App, LogLevel, Assistant } = require('@slack/bolt');
const { config } = require('dotenv');
const { OpenAI } = require('openai');
const express = require('express');

config();

// Setup Slack Bolt App
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  logLevel: LogLevel.DEBUG,
});

// Create an Express app for health checks
const expressApp = express();

// Health check endpoint
expressApp.get('/', (req, res) => {
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
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': process.env.APP_URL || 'https://github.com/9Zero-Climate/member-connections-ai',
    'X-Title': 'Member Connections AI',
  },
});

const DEFAULT_SYSTEM_CONTENT = `You're an assistant in the Slack workspace for 9Zero Climate, a community of people working to end the climate crisis.
Users in the workspace will ask you to connect them with other members.
You'll respond to those questions in a professional way.
When you include markdown text, convert them to Slack compatible ones.
When a prompt has Slack's special syntax like <@USER_ID> or <#CHANNEL_ID>, you must keep them as-is in your response.`;

// Slack has a limit of 4000 characters per message
const MAX_MESSAGE_LENGTH = 3900;

const updateMessage = async ({ client, message, text }) => {
  await client.chat.update({
    channel: message.channel,
    ts: message.ts,
    text,
  });
};

const assistant = new Assistant({
  /**
   * (Recommended) A custom ThreadContextStore can be provided, inclusive of methods to
   * get and save thread context. When provided, these methods will override the `getThreadContext`
   * and `saveThreadContext` utilities that are made available in other Assistant event listeners.
   */
  // threadContextStore: {
  //   get: async ({ context, client, payload }) => {},
  //   save: async ({ context, client, payload }) => {},
  // },

  /**
   * `assistant_thread_started` is sent when a user opens the Assistant container.
   * This can happen via DM with the app or as a side-container within a channel.
   * https://api.slack.com/events/assistant_thread_started
   */
  threadStarted: async ({ event, logger, say, setSuggestedPrompts, saveThreadContext }) => {
    const { context } = event.assistant_thread;

    try {
      // Since context is not sent along with individual user messages, it's necessary to keep
      // track of the context of the conversation to better assist the user. Sending an initial
      // message to the user with context metadata facilitates this, and allows us to update it
      // whenever the user changes context (via the `assistant_thread_context_changed` event).
      // The `say` utility sends this metadata along automatically behind the scenes.
      // !! Please note: this is only intended for development and demonstrative purposes.
      await say('Hi, how can I help?');

      await saveThreadContext();

      const prompts = [
        {
          title: 'This is a suggested prompt',
          message:
            'When a user clicks a prompt, the resulting prompt message text can be passed ' +
            'directly to your LLM for processing.\n\nAssistant, please create some helpful prompts ' +
            'I can provide to my users.',
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

      /**
       * Provide the user up to 4 optional, preset prompts to choose from.
       * The optional `title` prop serves as a label above the prompts. If
       * not, provided, 'Try these prompts:' will be displayed.
       * https://api.slack.com/methods/assistant.threads.setSuggestedPrompts
       */
      await setSuggestedPrompts({ prompts, title: 'Here are some suggested options:' });
    } catch (e) {
      logger.error(e);
    }
  },

  /**
   * `assistant_thread_context_changed` is sent when a user switches channels
   * while the Assistant container is open. If `threadContextChanged` is not
   * provided, context will be saved using the AssistantContextStore's `save`
   * method (either the DefaultAssistantContextStore or custom, if provided).
   * https://api.slack.com/events/assistant_thread_context_changed
   */
  threadContextChanged: async ({ logger, saveThreadContext }) => {
    // const { channel_id, thread_ts, context: assistantContext } = event.assistant_thread;
    try {
      await saveThreadContext();
    } catch (e) {
      logger.error(e);
    }
  },

  /**
   * Messages sent to the Assistant do not contain a subtype and must
   * be deduced based on their shape and metadata (if provided).
   * https://api.slack.com/events/message
   */
  userMessage: async ({ message, client, logger, say, setTitle, setStatus }) => {
    const { channel, thread_ts } = message;
    let currentText = '';
    let lastUpdateTime = Date.now();
    const UPDATE_INTERVAL = 500; // 0.5 seconds

    try {
      await setTitle(message.text);
      await setStatus('is typing..');

      // Add thinking reaction to the original message
      await client.reactions.add({
        name: 'thinking_face',
        channel: channel,
        timestamp: message.ts,
      });

      const responseMessage = await say('thinking...');

      // Retrieve the Assistant thread history for context of question being asked
      const thread = await client.conversations.replies({
        channel,
        ts: thread_ts,
        oldest: thread_ts,
      });

      // Prepare and tag each message for LLM processing
      const userMessage = { role: 'user', content: message.text };
      const threadHistory = thread.messages.map((m) => {
        const role = m.bot_id ? 'assistant' : 'user';
        return { role, content: m.text };
      });

      const messages = [{ role: 'system', content: DEFAULT_SYSTEM_CONTENT }, ...threadHistory, userMessage];

      // Stream the response from OpenRouter
      const stream = await openai.chat.completions.create({
        model: 'google/gemini-2.0-flash-001',
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
            await updateMessage({ client, message: responseMessage, text: currentText });
            lastUpdateTime = now;
          }
        }
      }

      // Final update to ensure we have the complete message
      await updateMessage({ client, message: responseMessage, text: currentText });

      // Remove thinking reaction
      await client.reactions.remove({
        name: 'thinking_face',
        channel: channel,
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
      } catch (reactionError) {
        logger.error('Failed to remove thinking reaction:', reactionError);
      }

      await say({
        text: `Sorry, something went wrong.\n You may want to forward this error message to an admin: \`\`\`\n${JSON.stringify(e, null, 2)}\n\`\`\``,
      });
    }
  },
});

app.assistant(assistant);

/** Start the Bolt App */
(async () => {
  try {
    await app.start();
    app.logger.info('⚡️ Bolt app is running!');
  } catch (error) {
    app.logger.error('Failed to start the app', error);
  }
})();
