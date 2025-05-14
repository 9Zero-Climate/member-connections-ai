import type { WebClient } from '@slack/web-api/dist/WebClient';
import { XMLBuilder } from 'fast-xml-parser';
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
const allTools: LLMTool<any, any>[] = [SearchDocumentsTool, FetchLinkedInProfileTool, OnboardingThreadTool];

export const TOOL_NAMES = allTools.map((tool) => tool.toolName) as readonly string[];
export type ToolName = (typeof TOOL_NAMES)[number];

export const getToolSpecs = (userIsAdmin: boolean): ChatCompletionTool[] => {
  return allTools.filter((tool) => !tool.forAdminsOnly || userIsAdmin).map((tool) => tool.specForLLM);
};

export const getToolForToolCall = (toolCall: LLMToolCall): LLMTool<unknown, unknown> => {
  if (toolCall.type !== 'function') {
    logger.error({ toolCall }, 'Unhandled tool call type - not a function');
    throw new Error(`Unhandled tool call type - not a function: ${toolCall.type}`);
  }

  const toolName = toolCall.function.name;

  const tool = allTools.find((t) => t.toolName === toolName);
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

  return allTools.reduce<ToolImplementationsByName>((acc, tool) => {
    if (!tool.forAdminsOnly || userIsAdmin) {
      acc[tool.toolName] = (params: object) => tool.impl({ context, ...params });
    }
    return acc;
  }, {});
};

// --- Utility Functions ---

/**
 * Convert an object to XML. XML is a best practice format for feeding into LLMs
 *
 * @param obj - The object to convert
 * @returns The XML string
 */
// biome-ignore lint/suspicious/noExplicitAny: we literally want to convert any object to XML
export function objectToXml(obj: any): string {
  const builder = new XMLBuilder({
    format: true,
    indentBy: '  ',
  });

  return builder.build(obj);
}
