import type { WebClient } from '@slack/web-api';
import type { ChatCompletionTool } from 'openai/resources/chat';

// The instance of the tool, which is created by the constructor on the LLMToolClass
export interface LLMToolInstance<Params = unknown, Result = unknown> {
  impl: (params: Params) => Promise<Result>;
}

export interface LLMToolConstructorOptions {
  slackClient?: WebClient;
}

export interface LLMToolClass<
  Params = unknown,
  Result = unknown,
  Instance extends LLMToolInstance<Params, Result> = LLMToolInstance<Params, Result>,
> {
  new (options?: LLMToolConstructorOptions): Instance;
  readonly toolName: string;
  readonly specForLLM: ChatCompletionTool;
  readonly forAdminsOnly: boolean;
  readonly getShortDescription: (params: Params) => string;
}
