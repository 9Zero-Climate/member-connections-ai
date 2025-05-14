import { objectToXml } from '.';
import type { LLMToolCall /*, ToolImplementationsByName */ } from './index';
import type { WebClient } from '@slack/web-api/dist/WebClient';
import type { LLMTool, LLMToolContext } from './LLMToolInterface';

// Helper to create a generic mock LLMTool
const createMockLlmTool = (
  name: string,
  isAdmin: boolean,
  // biome-ignore lint/suspicious/noExplicitAny: mocking
  specFunctionParams: any = {},
  // biome-ignore lint/suspicious/noExplicitAny: mocking
): LLMTool<any, { result: string }> => ({
  toolName: name,
  forAdminsOnly: isAdmin,
  specForLLM: {
    type: 'function',
    function: { name, description: `Mocked ${name}`, parameters: {}, ...specFunctionParams },
    // biome-ignore lint/suspicious/noExplicitAny: mocking
  } as any,
  // biome-ignore lint/suspicious/noExplicitAny: mocking
  getShortDescription: jest.fn((args: any) => `Short desc for ${name} with ${JSON.stringify(args)}`),
  // biome-ignore lint/suspicious/noExplicitAny: mocking
  impl: jest.fn(async (params: any & { context: LLMToolContext }) => ({
    result: `Impl for ${name} with ${params.arg ?? JSON.stringify(Object.fromEntries(Object.entries(params).filter(([k]) => k !== 'context')))}`,
  })),
});

// Instantiate tools for testing different scenarios
const generalToolMock = createMockLlmTool('general_tool_mock', false);
const adminToolMock = createMockLlmTool('admin_tool_mock', true);
const anotherGeneralToolMock = createMockLlmTool('another_general_tool_mock', false);

// Mock the actual tool modules to export these generated mocks
// These names (SearchDocumentsTool, etc.) must match what's imported in src/llmTools/index.ts
jest.mock('./tools/searchDocumentsTool', () => ({ SearchDocumentsTool: generalToolMock }));
jest.mock('./tools/fetchLinkedInProfileTool', () => ({ FetchLinkedInProfileTool: anotherGeneralToolMock }));
jest.mock('./tools/createOnboardingThreadTool', () => ({ OnboardingThreadTool: adminToolMock }));

describe('objectToXml', () => {
  it.each([
    {
      description: 'should handle null input',
      input: null,
      expected: '<root/>\n',
    },
    {
      description: 'should handle undefined input',
      input: undefined,
      expected: '',
    },
    {
      description: 'should handle primitive values',
      input: 42,
      expected: '<root>42</root>\n',
    },
    {
      description: 'should handle simple object',
      input: { name: 'test', value: 123 },
      expected: '<root>\n  <name>test</name>\n  <value>123</value>\n</root>\n',
    },
    {
      description: 'should handle nested objects',
      input: {
        outer: {
          inner: 'value',
          number: 42,
        },
      },
      expected: '<root>\n  <outer>\n    <inner>value</inner>\n    <number>42</number>\n  </outer>\n</root>\n',
    },
    {
      description: 'should handle array values',
      input: { items: ['a', 'b', 'c'] },
      expected: '<root>\n  <items>a</items>\n  <items>b</items>\n  <items>c</items>\n</root>\n',
    },
    {
      description: 'should respect custom indentation',
      input: { test: 'value' },
      expected: '<root>\n  <test>value</test>\n</root>\n',
    },
  ])('$description', ({ input, expected }) => {
    if (input === undefined) {
      expect(objectToXml(input)).toBe(expected);
    } else {
      expect(objectToXml({ root: input })).toBe(expected);
    }
  });
});

describe('LLM Tools Index Logic', () => {
  let LlmToolsIndex: typeof import('./index');

  beforeEach(() => {
    jest.resetModules();
    LlmToolsIndex = require('./index');

    (generalToolMock.getShortDescription as jest.Mock).mockClear();
    (generalToolMock.impl as jest.Mock).mockClear();
    (adminToolMock.getShortDescription as jest.Mock).mockClear();
    (adminToolMock.impl as jest.Mock).mockClear();
    (anotherGeneralToolMock.getShortDescription as jest.Mock).mockClear();
    (anotherGeneralToolMock.impl as jest.Mock).mockClear();
  });

  describe('TOOL_NAMES', () => {
    it('contains the names of all registered mock tools', () => {
      expect(LlmToolsIndex.TOOL_NAMES).toEqual(
        expect.arrayContaining([generalToolMock.toolName, adminToolMock.toolName, anotherGeneralToolMock.toolName]),
      );
      expect(LlmToolsIndex.TOOL_NAMES.length).toBe(3);
    });
  });

  describe('getToolSpecs', () => {
    it('returns specs for all tools if userIsAdmin is true', () => {
      const specs = LlmToolsIndex.getToolSpecs(true);
      expect(specs).toHaveLength(3);
      expect(specs).toEqual(
        expect.arrayContaining([
          generalToolMock.specForLLM,
          adminToolMock.specForLLM,
          anotherGeneralToolMock.specForLLM,
        ]),
      );
    });

    it('returns specs for non-admin tools if userIsAdmin is false', () => {
      const specs = LlmToolsIndex.getToolSpecs(false);
      expect(specs).toHaveLength(2); // generalToolMock and anotherGeneralToolMock
      expect(specs).toEqual(expect.arrayContaining([generalToolMock.specForLLM, anotherGeneralToolMock.specForLLM]));
      expect(specs).not.toContainEqual(adminToolMock.specForLLM);
    });
  });

  describe('getToolForToolCall', () => {
    it('returns the correct tool for a valid tool call', () => {
      const toolCall: LLMToolCall = {
        id: 'call123',
        type: 'function',
        function: {
          name: generalToolMock.toolName,
          arguments: '{"arg":"test"}',
        },
      };
      const tool = LlmToolsIndex.getToolForToolCall(toolCall);
      expect(tool.toolName).toBe(generalToolMock.toolName);
    });

    it('throws an error for an unknown tool name', () => {
      const toolCall: LLMToolCall = {
        id: 'call456',
        type: 'function',
        function: {
          name: 'unknown_tool_for_sure',
          arguments: '{}',
        },
      };
      expect(() => LlmToolsIndex.getToolForToolCall(toolCall)).toThrow('Unhandled tool call: unknown_tool_for_sure');
    });

    it('throws an error for a non-function tool call type', () => {
      const toolCall = {
        id: 'call789',
        type: 'not_a_function_type',
        function: { name: generalToolMock.toolName, arguments: '{}' },
      } as unknown as LLMToolCall;
      expect(() => LlmToolsIndex.getToolForToolCall(toolCall)).toThrow(
        'Unhandled tool call type - not a function: not_a_function_type',
      );
    });
  });

  describe('getToolCallShortDescription', () => {
    it('returns the short description from the tool, parsing arguments', () => {
      const args = { data: 'some data' };
      const toolCall: LLMToolCall = {
        id: 'callDescSearch',
        type: 'function',
        function: {
          name: generalToolMock.toolName,
          arguments: JSON.stringify(args),
        },
      };
      expect(LlmToolsIndex.getToolCallShortDescription(toolCall)).toBe(
        `Short desc for ${generalToolMock.toolName} with ${JSON.stringify(args)}`,
      );
    });
  });

  describe('getToolImplementationsMap', () => {
    const mockSlackClient = { client: 'mock' } as unknown as WebClient;
    const outerContext = { slackClient: mockSlackClient };

    type MockToolImplementationWrapper = (params: object) => Promise<unknown>;
    type MockToolImplementationsMap = { [key: string]: MockToolImplementationWrapper };

    it('returns implementations for all tools if userIsAdmin is true and calls impl correctly', async () => {
      const implementations = LlmToolsIndex.getToolImplementationsMap({
        slackClient: mockSlackClient,
        userIsAdmin: true,
      }) as MockToolImplementationsMap;

      expect(Object.keys(implementations)).toHaveLength(3);

      const generalToolParams = { arg: 'general use' };
      await implementations[generalToolMock.toolName](generalToolParams);
      expect(generalToolMock.impl).toHaveBeenCalledWith({ context: outerContext, ...generalToolParams });

      const adminToolParams = { arg: 'admin power' };
      await implementations[adminToolMock.toolName](adminToolParams);
      expect(adminToolMock.impl).toHaveBeenCalledWith({ context: outerContext, ...adminToolParams });
    });

    it('returns implementations for non-admin tools if userIsAdmin is false', async () => {
      const implementations = LlmToolsIndex.getToolImplementationsMap({
        slackClient: mockSlackClient,
        userIsAdmin: false,
      }) as MockToolImplementationsMap;

      expect(Object.keys(implementations)).toHaveLength(2); // generalToolMock and anotherGeneralToolMock
      expect(implementations[generalToolMock.toolName]).toBeDefined();
      expect(implementations[anotherGeneralToolMock.toolName]).toBeDefined();
      expect(implementations[adminToolMock.toolName]).toBeUndefined();

      const generalToolParams = { arg: 'general use again' };
      await implementations[generalToolMock.toolName](generalToolParams);
      expect(generalToolMock.impl).toHaveBeenCalledWith({ context: outerContext, ...generalToolParams });
    });
  });
});
