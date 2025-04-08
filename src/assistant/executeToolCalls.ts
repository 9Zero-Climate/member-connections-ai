import type { ChatCompletionAssistantMessageParam, ChatCompletionToolMessageParam } from 'openai/resources/chat';
import { logger } from '../services/logger';
import { type ToolCall, objectToXml } from '../services/tools';

// Define the expected type for the injected implementations map
// biome-ignore lint/suspicious/noExplicitAny: Tool functions can have varied args/return types
type ToolImplementationsMap = Record<string, (args: any) => Promise<any>>;

/**
 * Executes a list of tool calls using provided implementations and returns the results.
 *
 * @param toolCalls - The list of tool calls requested by the LLM.
 * @param toolImplementations - A map of tool names to their implementation functions.
 * @returns An array of ChatCompletion*MessageParam containing the results. This should be appended to the LLM thread.
 */
export default async function executeToolCalls(
  toolCalls: ToolCall[],
  toolImplementations: ToolImplementationsMap,
): Promise<(ChatCompletionToolMessageParam | ChatCompletionAssistantMessageParam)[]> {
  const toolCallAndResultMessages: (ChatCompletionToolMessageParam | ChatCompletionAssistantMessageParam)[] = [
    {
      role: 'assistant',
      tool_calls: toolCalls,
    },
  ];

  for (const toolCall of toolCalls) {
    const toolName = toolCall.function.name;

    // biome-ignore lint/suspicious/noExplicitAny: Tool arguments can be any valid JSON structure
    let toolArgs: any;
    let toolResultContent: string;

    try {
      toolArgs = JSON.parse(toolCall.function.arguments);
    } catch (error) {
      logger.error({ err: error, toolCall }, 'Failed to parse tool arguments');
      toolResultContent = objectToXml({ error: 'Failed to parse arguments JSON', args: toolCall.function.arguments });
      toolCallAndResultMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolResultContent,
      });
      continue;
    }

    const toolImplementation = toolImplementations[toolName];

    if (!toolImplementation) {
      logger.error({ toolCall }, 'Unknown tool called');
      toolResultContent = objectToXml({ error: `Unknown tool: ${toolName}` });
    } else {
      try {
        const toolCallResult = await toolImplementation(toolArgs);
        logger.info(
          {
            toolCall: {
              name: toolName,
              args: toolArgs,
              result: toolCallResult,
            },
          },
          'Tool call executed',
        );
        toolResultContent = objectToXml(toolCallResult);
      } catch (error) {
        logger.error({ err: error, toolCall }, 'Error executing tool');
        toolResultContent = objectToXml({
          error: `Error executing tool ${toolName}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }

    // Add the successful result or error result to the list
    toolCallAndResultMessages.push({
      role: 'tool',
      tool_call_id: toolCall.id,
      content: toolResultContent,
    });
  }

  return toolCallAndResultMessages;
}
