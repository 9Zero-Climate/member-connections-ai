import type { WebClient } from '@slack/web-api/dist/WebClient';
import type { LLMTool, LLMToolContext } from './LLMToolInterface';
import type { LLMToolCall /*, ToolImplementationsByName */ } from './index';

// Helper to create a generic mock LLMTool
const createMockLlmTool = (
  name: string,
  isAdmin: boolean,
  // biome-ignore lint/suspicious/noExplicitAny: mocking
  specFunctionParams: any = {},
  // biome-ignore lint/suspicious/noExplicitAny: mocking
): LLMTool<any, { result: string }> => ({
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
const generalToolName = 'general_tool_mock';
const generalToolMock = createMockLlmTool(generalToolName, false);
const adminToolName = 'admin_tool_mock';
const adminToolMock = createMockLlmTool(adminToolName, true);
const anotherGeneralToolName = 'another_general_tool_mock';
const anotherGeneralToolMock = createMockLlmTool(anotherGeneralToolName, false);
const searchMembersToolName = 'search_members_tool_mock';
const searchMembersToolMock = createMockLlmTool(searchMembersToolName, false);

// Mock the actual tool modules to export these generated mocks
// These names (SearchDocumentsTool, etc.) must match what's imported in src/llmTools/index.ts
jest.mock('./tools/searchMembersTool', () => ({
  // Use a getter to ensure mocks are initialized before access
  get SearchMembersTool() {
    // Assuming SearchMembersTool is a general, non-admin tool for this mock
    return searchMembersToolMock;
  },
}));
jest.mock('./tools/searchDocumentsTool', () => ({
  // Use a getter to ensure mocks are initialized before access
  get SearchDocumentsTool() {
    return generalToolMock;
  },
}));
jest.mock('./tools/fetchLinkedInProfileTool', () => ({
  get FetchLinkedInProfileTool() {
    return anotherGeneralToolMock;
  },
}));
jest.mock('./tools/createOnboardingThreadTool', () => ({
  get OnboardingThreadTool() {
    return adminToolMock;
  },
}));

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
        expect.arrayContaining([
          searchMembersToolMock.specForLLM.function.name,
          generalToolMock.specForLLM.function.name,
          adminToolMock.specForLLM.function.name,
          anotherGeneralToolMock.specForLLM.function.name,
        ]),
      );
      expect(LlmToolsIndex.TOOL_NAMES.length).toBe(4);
    });
  });

  describe('getToolName', () => {
    it('returns the name of the tool', () => {
      expect(LlmToolsIndex.getToolName(generalToolMock as LLMTool<unknown, unknown>)).toBe(generalToolName);
    });
  });

  describe('getToolSpecs', () => {
    it('returns specs for all tools if userIsAdmin is true', () => {
      const specs = LlmToolsIndex.getToolSpecs(true);
      expect(specs).toHaveLength(4);
      expect(specs).toEqual(
        expect.arrayContaining([
          searchMembersToolMock.specForLLM,
          generalToolMock.specForLLM,
          adminToolMock.specForLLM,
          anotherGeneralToolMock.specForLLM,
        ]),
      );
    });

    it('returns specs for non-admin tools if userIsAdmin is false', () => {
      const specs = LlmToolsIndex.getToolSpecs(false);
      expect(specs).toHaveLength(3); // searchMembersToolMock, generalToolMock and anotherGeneralToolMock
      expect(specs).toEqual(
        expect.arrayContaining([
          searchMembersToolMock.specForLLM,
          generalToolMock.specForLLM,
          anotherGeneralToolMock.specForLLM,
        ]),
      );
      expect(specs).not.toContainEqual(adminToolMock.specForLLM);
    });
  });

  describe('getToolForToolCall', () => {
    it('returns the correct tool for a valid tool call', () => {
      const toolCall: LLMToolCall = {
        id: 'call123',
        type: 'function',
        function: {
          name: generalToolMock.specForLLM.function.name,
          arguments: '{"arg":"test"}',
        },
      };
      const tool = LlmToolsIndex.getToolForToolCall(toolCall);
      expect(tool).toBe(generalToolMock);
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
        function: { name: 'foo', arguments: '{}' },
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
          name: generalToolMock.specForLLM.function.name,
          arguments: JSON.stringify(args),
        },
      };
      expect(LlmToolsIndex.getToolCallShortDescription(toolCall)).toBe(
        `Short desc for ${generalToolName} with ${JSON.stringify(args)}`,
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

      expect(Object.keys(implementations)).toHaveLength(4);

      const generalToolParams = { arg: 'general use' };
      await implementations[generalToolName](generalToolParams);
      expect(generalToolMock.impl).toHaveBeenCalledWith({ context: outerContext, ...generalToolParams });

      const adminToolParams = { arg: 'admin power' };
      await implementations[adminToolName](adminToolParams);
      expect(adminToolMock.impl).toHaveBeenCalledWith({ context: outerContext, ...adminToolParams });
    });

    it('returns implementations for non-admin tools if userIsAdmin is false', async () => {
      const implementations = LlmToolsIndex.getToolImplementationsMap({
        slackClient: mockSlackClient,
        userIsAdmin: false,
      }) as MockToolImplementationsMap;

      expect(Object.keys(implementations)).toHaveLength(3); // searchMembersToolMock, generalToolMock and anotherGeneralToolMock
      expect(implementations[searchMembersToolName]).toBeDefined();
      expect(implementations[generalToolName]).toBeDefined();
      expect(implementations[anotherGeneralToolName]).toBeDefined();
      expect(implementations[adminToolName]).toBeUndefined();

      const generalToolParams = { arg: 'general use again' };
      await implementations[generalToolName](generalToolParams);
      expect(generalToolMock.impl).toHaveBeenCalledWith({ context: outerContext, ...generalToolParams });

      const searchMembersToolParams = { query: 'find devs' };
      await implementations[searchMembersToolName](searchMembersToolParams);
      expect(searchMembersToolMock.impl).toHaveBeenCalledWith({ context: outerContext, ...searchMembersToolParams });
    });
  });
});
