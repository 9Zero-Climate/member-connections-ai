import type { SayFn } from '@slack/bolt';
import type { ChatPostMessageResponse, WebClient } from '@slack/web-api';
import { config } from '../../config';
import ResponseManager from './ResponseManager';

describe('ResponseManager', () => {
  let mockClient: { chat: { update: jest.Mock } };
  let mockSay: jest.MockedFunction<SayFn>;
  let responseManager: ResponseManager;

  beforeEach(() => {
    mockClient = {
      chat: {
        update: jest.fn(),
      },
    };

    mockSay = jest.fn();

    responseManager = new ResponseManager({
      client: mockClient as unknown as WebClient,
      say: mockSay,
    });
  });

  it('should create new message on first update if text is long enough', async () => {
    const text = 'This is a long enough message';
    const mockResponse: ChatPostMessageResponse = {
      ok: true,
      channel: 'test-channel',
      ts: '1234567890.123456',
      message: { text },
    };

    mockSay.mockResolvedValueOnce(mockResponse);

    await responseManager.updateMessage(text);

    expect(mockSay).toHaveBeenCalledWith({
      text,
      parse: 'full',
    });
    expect(mockClient.chat.update).not.toHaveBeenCalled();
  });

  it('should not create message if text is too short', async () => {
    const text = 'Short';
    await responseManager.updateMessage(text);

    expect(mockSay).not.toHaveBeenCalled();
    expect(mockClient.chat.update).not.toHaveBeenCalled();
  });

  it('should update existing message on subsequent updates', async () => {
    const initialText = 'Initial long message';
    const updatedText = 'Updated long message';
    const mockResponse: ChatPostMessageResponse = {
      ok: true,
      channel: 'test-channel',
      ts: '1234567890.123456',
      message: { text: initialText },
    };

    mockSay.mockResolvedValueOnce(mockResponse);
    mockClient.chat.update.mockResolvedValueOnce(mockResponse);

    // First update creates message
    await responseManager.updateMessage(initialText);

    // Wait for cooldown
    await new Promise((resolve) => setTimeout(resolve, config.chatEditIntervalMs));

    // Second update updates existing message
    await responseManager.updateMessage(updatedText);

    expect(mockSay).toHaveBeenCalledTimes(1);
    expect(mockClient.chat.update).toHaveBeenCalledWith({
      channel: 'test-channel',
      ts: '1234567890.123456',
      text: updatedText,
    });
  });

  it('should finalize message with cooldown', async () => {
    const text = 'Final message';
    const mockResponse: ChatPostMessageResponse = {
      ok: true,
      channel: 'test-channel',
      ts: '1234567890.123456',
      message: { text },
    };

    mockSay.mockResolvedValueOnce(mockResponse);
    mockSay.mockResolvedValueOnce(mockResponse);

    await responseManager.updateMessage(text);
    await responseManager.finalizeMessage();

    // Wait for cooldown period
    await new Promise((resolve) => setTimeout(resolve, config.chatEditIntervalMs));

    // Should be reset for next use
    await responseManager.updateMessage('New message');
    expect(mockSay).toHaveBeenCalledTimes(2);
  });

  it('should throw error if message update missing required fields', async () => {
    const text = 'Test message';
    const mockResponse: ChatPostMessageResponse = {
      ok: true,
      message: { text },
    };

    mockSay.mockResolvedValueOnce(mockResponse);

    await responseManager.updateMessage(text);

    await expect(responseManager.finalizeMessage()).rejects.toThrow(
      'Failed to get timestamp or channel from response message',
    );
  });
});
