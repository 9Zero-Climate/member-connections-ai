import type { WebClient } from '@slack/web-api';
import type { ChatCompletionTool } from 'openai/resources/chat';

export type LLMToolContext = {
  slackClient: WebClient;
};

export type ToolImplementation<Params, Result> = (params: Params & { context: LLMToolContext }) => Promise<Result>;

export type LLMTool<Params = unknown, Result = unknown> = {
  toolName: string;
  specForLLM: ChatCompletionTool;
  forAdminsOnly: boolean;
  getShortDescription: (params: Params) => string;
  impl: ToolImplementation<Params, Result>;
};
