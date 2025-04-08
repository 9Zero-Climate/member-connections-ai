import type { AssistantThreadStartedMiddlewareArgs } from '@slack/bolt/dist/Assistant';
import { logger } from '../../services/logger';

// Define AssistantPrompt locally since it's not exported by Bolt
interface AssistantPrompt {
  title: string;
  message: string;
}

export default async function threadStartedHandler({
  event,
  say,
  setSuggestedPrompts,
  saveThreadContext,
}: AssistantThreadStartedMiddlewareArgs) {
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
}
