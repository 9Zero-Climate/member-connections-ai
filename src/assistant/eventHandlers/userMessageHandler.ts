import type { AssistantUserMessageMiddlewareArgs } from '@slack/bolt/dist/Assistant';
import type { WebClient } from '@slack/web-api';
import type { OpenAI } from 'openai';
import type { SlackMessage } from '../initialLlmThread';
import { handleIncomingMessage } from '../llmConversation';

/**
 * Handles a user message from Slack by calling the central message processing orchestrator.
 */
export const handleUserMessage = async (
  llmClient: OpenAI,
  client: WebClient,
  args: AssistantUserMessageMiddlewareArgs,
) => {
  const { message: slackMessage, say } = args;

  // Call the central handler
  await handleIncomingMessage({
    llmClient,
    client,
    slackMessage: slackMessage as SlackMessage,
    say,
  });
};
