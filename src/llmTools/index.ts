import type { WebClient } from '@slack/web-api/dist/WebClient';
import type { ChatCompletionTool } from 'openai/resources/chat';
import { logger } from '../services/logger';

import type { LLMTool, LLMToolContext, ToolImplementation } from './LLMToolInterface';
import { OnboardingThreadTool } from './tools/createOnboardingThreadTool';
import { FetchLinkedInProfileTool } from './tools/fetchLinkedInProfileTool';
import { SearchDocumentsTool } from './tools/searchDocumentsTool';

export type LLMToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

// biome-ignore lint/suspicious/noExplicitAny: The LLMTool inputs and outputs are different for each tool
const ALL_TOOLS: LLMTool<any, any>[] = [SearchDocumentsTool, FetchLinkedInProfileTool, OnboardingThreadTool];

export const TOOL_NAMES = ALL_TOOLS.map((tool) => tool.toolName) as readonly string[];
export type ToolName = (typeof TOOL_NAMES)[number];

export const getToolSpecs = (userIsAdmin: boolean): ChatCompletionTool[] => {
  return ALL_TOOLS.filter((tool) => !tool.forAdminsOnly || userIsAdmin).map((tool) => tool.specForLLM);
};

export const getToolForToolCall = (toolCall: LLMToolCall): LLMTool<unknown, unknown> => {
  if (toolCall.type !== 'function') {
    logger.error({ toolCall }, 'Unhandled tool call type - not a function');
    throw new Error(`Unhandled tool call type - not a function: ${toolCall.type}`);
  }

  const toolName = toolCall.function.name;

  const tool = ALL_TOOLS.find((t) => t.toolName === toolName);
  if (!tool) {
    logger.error({ toolCall, toolName }, 'Unknown tool name encountered');
    throw new Error(`Unhandled tool call: ${toolName}`);
  }

  return tool;
};

// Get a short description of the tool call suitable for a user facing message
export const getToolCallShortDescription = (toolCall: LLMToolCall): string => {
  const tool = getToolForToolCall(toolCall);
  const toolArgs = JSON.parse(toolCall.function.arguments);

  return tool.getShortDescription(toolArgs);
};

// --- Tool Implementations ---

export type ToolImplementationsByName = {
  [key: string]: ToolImplementation<object, unknown>;
};

export const getToolImplementationsMap = ({
  slackClient,
  userIsAdmin,
}: { slackClient: WebClient; userIsAdmin: boolean }): ToolImplementationsByName => {
  const context: LLMToolContext = { slackClient };

  const toolNamesAndImplementations = ALL_TOOLS.filter((tool) => !tool.forAdminsOnly || userIsAdmin).map((tool) => {
    return [tool.toolName, (params: object) => tool.impl({ context, ...params })];
  });

  return Object.fromEntries(toolNamesAndImplementations);
};
