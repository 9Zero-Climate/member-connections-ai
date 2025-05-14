import type { WebClient } from '@slack/web-api/dist/WebClient';
import { XMLBuilder } from 'fast-xml-parser';
import type { ChatCompletionTool } from 'openai/resources/chat';
import { logger } from '../services/logger';

import type { LLMToolClass } from './LLMToolInterface';
import {
  type CreateOnboardingThreadParams,
  type CreateOnboardingThreadResult,
  OnboardingThreadTool,
} from './tools/createOnboardingThreadTool';
import {
  FetchLinkedInProfileTool,
  type LinkedInProfileToolParams,
  type LinkedInProfileToolResult,
} from './tools/fetchLinkedInProfileTool';
import { SearchDocumentsTool, type SearchToolParams, type SearchToolResult } from './tools/searchDocumentsTool';

export type {
  CreateOnboardingThreadParams,
  CreateOnboardingThreadResult,
  SearchToolParams,
  SearchToolResult,
  LinkedInProfileToolParams,
  LinkedInProfileToolResult,
};

export interface LLMToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

// biome-ignore lint/suspicious/noExplicitAny: The LLMToolClass inputs and outputs are different for each tool
const allToolClasses: LLMToolClass<any, any>[] = [SearchDocumentsTool, FetchLinkedInProfileTool, OnboardingThreadTool];

export const TOOL_NAMES = allToolClasses.map((cls) => cls.toolName) as readonly string[];
export type ToolName = (typeof TOOL_NAMES)[number];

export const getToolSpecs = (userIsAdmin: boolean): ChatCompletionTool[] => {
  return allToolClasses.filter((cls) => !cls.forAdminsOnly || userIsAdmin).map((cls) => cls.specForLLM);
};

export const getToolClassForToolCall = (toolCall: LLMToolCall): LLMToolClass<unknown, unknown> => {
  if (toolCall.type !== 'function') {
    logger.error({ toolCall }, 'Unhandled tool call type - not a function');
    throw new Error(`Unhandled tool call type - not a function: ${toolCall.type}`);
  }

  const toolName = toolCall.function.name;

  const toolClass = allToolClasses.find((cls) => cls.toolName === toolName);
  if (!toolClass) {
    logger.error({ toolCall, toolName }, 'Unknown tool name encountered');
    throw new Error(`Unhandled tool call: ${toolName}`);
  }

  return toolClass;
};

export const getToolCallShortDescription = (toolCall: LLMToolCall): string => {
  const toolClass = getToolClassForToolCall(toolCall);
  const toolArgs = JSON.parse(toolCall.function.arguments);

  return toolClass.getShortDescription(toolArgs);
};

// --- Tool Implementations ---
type ToolImplementation<Params, Result> = (params: Params) => Promise<Result>;

// ToolImplementationsByName uses unknown as a general placeholder, specific tools' impls will match.
export type ToolImplementationsByName = {
  [key in ToolName]?: ToolImplementation<unknown, unknown>;
};

// Map of tool names to their implementations
export const getToolImplementationsMap = ({
  slackClient,
  userIsAdmin,
}: { slackClient: WebClient; userIsAdmin: boolean }): ToolImplementationsByName => {
  return allToolClasses.reduce<ToolImplementationsByName>((acc, toolClass) => {
    if (!toolClass.forAdminsOnly || userIsAdmin) {
      acc[toolClass.toolName] = new toolClass({ slackClient }).impl;
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
