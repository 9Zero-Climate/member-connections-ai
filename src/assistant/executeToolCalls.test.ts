import type { LLMToolCall } from '../llmTools';
import { objectToXml } from '../llmTools';
import executeToolCalls from './executeToolCalls';

// Mock logger to prevent test logs
jest.mock('../services/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  logUncaughtErrors: jest.fn(),
}));

// Mock objectToXml for predictable output verification
jest.mock('../llmTools', () => ({
  // Keep original ToolCall type if needed, mock implementations
  ...jest.requireActual('../llmTools'),
  objectToXml: jest.fn((obj) => JSON.stringify(obj)),
}));

describe('executeToolCalls', () => {
  let mockToolImplementations: Record<string, jest.Mock>;

  beforeEach(() => {
    mockToolImplementations = {
      get_weather: jest.fn(),
      get_stock_price: jest.fn(),
    };
  });

  it('should execute a single valid tool call and return results', async () => {
    const toolCalls: LLMToolCall[] = [
      {
        id: 'call_1',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: JSON.stringify({ location: 'London' }),
        },
      },
    ];
    const mockResult = { temperature: '15C', condition: 'Cloudy' };
    mockToolImplementations.get_weather.mockResolvedValue(mockResult);

    const resultMessages = await executeToolCalls(toolCalls, mockToolImplementations);

    expect(resultMessages).toHaveLength(2);
    expect(resultMessages[0]).toEqual({ role: 'assistant', tool_calls: toolCalls });
    expect(resultMessages[1]).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: JSON.stringify(mockResult), // Based on mocked objectToXml
    });
    expect(mockToolImplementations.get_weather).toHaveBeenCalledWith({ location: 'London' });
    expect(objectToXml).toHaveBeenCalledWith(mockResult);
  });

  it('should execute multiple tool calls', async () => {
    const toolCalls: LLMToolCall[] = [
      {
        id: 'call_weather',
        type: 'function',
        function: { name: 'get_weather', arguments: '{"location": "Paris"}' },
      },
      {
        id: 'call_stock',
        type: 'function',
        function: { name: 'get_stock_price', arguments: '{"ticker": "ACME"}' },
      },
    ];
    const weatherResult = { temperature: '20C' };
    const stockResult = { price: 123.45 };
    mockToolImplementations.get_weather.mockResolvedValue(weatherResult);
    mockToolImplementations.get_stock_price.mockResolvedValue(stockResult);

    const resultMessages = await executeToolCalls(toolCalls, mockToolImplementations);

    expect(resultMessages).toHaveLength(3); // 1 assistant + 2 tool results
    expect(resultMessages[0].role).toBe('assistant');
    expect(resultMessages[1]).toEqual({
      role: 'tool',
      tool_call_id: 'call_weather',
      content: JSON.stringify(weatherResult),
    });
    expect(resultMessages[2]).toEqual({
      role: 'tool',
      tool_call_id: 'call_stock',
      content: JSON.stringify(stockResult),
    });
    expect(mockToolImplementations.get_weather).toHaveBeenCalledWith({ location: 'Paris' });
    expect(mockToolImplementations.get_stock_price).toHaveBeenCalledWith({ ticker: 'ACME' });
  });

  it('should handle JSON parsing errors for arguments', async () => {
    const toolCalls: LLMToolCall[] = [
      {
        id: 'call_bad_args',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: '{"location": "Berlin",}', // Invalid JSON (trailing comma)
        },
      },
    ];
    const expectedErrorContent = JSON.stringify({
      error: 'Failed to parse arguments JSON',
      args: toolCalls[0].function.arguments,
    });

    const resultMessages = await executeToolCalls(toolCalls, mockToolImplementations);

    expect(resultMessages).toHaveLength(2);
    expect(resultMessages[1]).toEqual({
      role: 'tool',
      tool_call_id: 'call_bad_args',
      content: expectedErrorContent,
    });
    expect(mockToolImplementations.get_weather).not.toHaveBeenCalled();
    expect(objectToXml).toHaveBeenCalledWith({ error: expect.any(String), args: expect.any(String) });
  });

  it('should handle unknown tool names', async () => {
    const toolCalls: LLMToolCall[] = [
      {
        id: 'call_unknown',
        type: 'function',
        function: { name: 'get_rocket_fuel_level', arguments: '{}' },
      },
    ];
    const expectedErrorContent = JSON.stringify({ error: 'Unknown tool: get_rocket_fuel_level' });

    const resultMessages = await executeToolCalls(toolCalls, mockToolImplementations);

    expect(resultMessages).toHaveLength(2);
    expect(resultMessages[1]).toEqual({
      role: 'tool',
      tool_call_id: 'call_unknown',
      content: expectedErrorContent,
    });
    expect(objectToXml).toHaveBeenCalledWith({ error: expect.stringContaining('Unknown tool') });
  });

  it('should handle errors thrown by the tool implementation', async () => {
    const toolCalls: LLMToolCall[] = [
      {
        id: 'call_throws',
        type: 'function',
        function: { name: 'get_weather', arguments: '{"location": "Volcano"}' },
      },
    ];
    const errorMessage = 'API unreachable'; // Correct variable name
    mockToolImplementations.get_weather.mockRejectedValue(new Error(errorMessage));
    const expectedErrorContent = JSON.stringify({ error: `Error executing tool get_weather: ${errorMessage}` });

    const resultMessages = await executeToolCalls(toolCalls, mockToolImplementations);

    expect(resultMessages).toHaveLength(2);
    expect(resultMessages[1]).toEqual({
      role: 'tool',
      tool_call_id: 'call_throws',
      content: expectedErrorContent,
    });
    expect(mockToolImplementations.get_weather).toHaveBeenCalledWith({ location: 'Volcano' });
    expect(objectToXml).toHaveBeenCalledWith({ error: expect.stringContaining(errorMessage) });
  });

  it('should handle a mix of successful and failing tool calls', async () => {
    const toolCalls: LLMToolCall[] = [
      {
        id: 'call_ok',
        type: 'function',
        function: { name: 'get_stock_price', arguments: '{"ticker": "GOOD"}' },
      },
      {
        id: 'call_fail_args',
        type: 'function',
        function: { name: 'get_weather', arguments: 'invalid-json' },
      },
      {
        id: 'call_fail_impl',
        type: 'function',
        function: { name: 'get_stock_price', arguments: '{"ticker": "BAD"}' },
      },
    ];
    const stockResult = { price: 500 };
    const implErrorMessage = 'Bad ticker symbol'; // Correct variable name
    mockToolImplementations.get_stock_price
      .mockResolvedValueOnce(stockResult) // For GOOD
      .mockRejectedValueOnce(new Error(implErrorMessage)); // For BAD

    const expectedArgErrorContent = JSON.stringify({ error: 'Failed to parse arguments JSON', args: 'invalid-json' });
    const expectedImplErrorContent = JSON.stringify({
      error: `Error executing tool get_stock_price: ${implErrorMessage}`,
    });

    const resultMessages = await executeToolCalls(toolCalls, mockToolImplementations);

    expect(resultMessages).toHaveLength(4); // 1 assistant + 3 tool results
    expect(resultMessages[0].role).toBe('assistant');
    expect(resultMessages[1]).toEqual({
      // call_ok
      role: 'tool',
      tool_call_id: 'call_ok',
      content: JSON.stringify(stockResult),
    });
    expect(resultMessages[2]).toEqual({
      // call_fail_args
      role: 'tool',
      tool_call_id: 'call_fail_args',
      content: expectedArgErrorContent,
    });
    expect(resultMessages[3]).toEqual({
      // call_fail_impl
      role: 'tool',
      tool_call_id: 'call_fail_impl',
      content: expectedImplErrorContent,
    });

    expect(mockToolImplementations.get_stock_price).toHaveBeenCalledTimes(2);
    expect(mockToolImplementations.get_stock_price).toHaveBeenCalledWith({ ticker: 'GOOD' });
    expect(mockToolImplementations.get_stock_price).toHaveBeenCalledWith({ ticker: 'BAD' });
    expect(mockToolImplementations.get_weather).not.toHaveBeenCalled(); // Due to arg parse error
  });
});
