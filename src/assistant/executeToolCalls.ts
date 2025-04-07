import type { ChatCompletionToolMessageParam } from 'openai/resources/chat';
import { logger } from '../services/logger';
import { type ToolCall, objectToXml, toolImplementations } from '../services/tools';

/**
 * Executes a list of tool calls and returns the results as tool messages.
 *
 * @param toolCalls - The list of tool calls requested by the LLM.
 * @returns An array of ChatCompletionToolMessageParam containing the results or errors.
 */
export default async function executeToolCalls(toolCalls: ToolCall[]): Promise<ChatCompletionToolMessageParam[]> {
  const toolResultMessages: ChatCompletionToolMessageParam[] = [];

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
      toolResultMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolResultContent,
      });
      continue;
    }

    const toolImplementation = toolImplementations[toolName as keyof typeof toolImplementations];

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
    toolResultMessages.push({
      role: 'tool',
      tool_call_id: toolCall.id,
      content: toolResultContent,
    });
  }

  return toolResultMessages;
}
