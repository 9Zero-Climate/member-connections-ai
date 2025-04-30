import type { SlackEventMiddlewareArgs } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import type { OpenAI } from 'openai';
import { logger } from '../../services/logger';
import type { SlackMessage } from '../initialLlmThread';
import { handleIncomingMessage } from '../llmConversation';

/**
 * Handle an app_mention event from Slack by calling the central message processing orchestrator.
 */
export const handleAppMention = async (
  llmClient: OpenAI,
  client: WebClient,
  args: SlackEventMiddlewareArgs<'app_mention'>,
) => {
  const { event, say } = args;
  logger.info({ event }, 'Handling app_mention event');

  // The AppMentionEvent structure matches SlackMessage closely enough for casting
  const slackMessage: SlackMessage = event as SlackMessage;

  await handleIncomingMessage({
    llmClient,
    client,
    slackMessage: slackMessage,
    say: say,
  });
};
