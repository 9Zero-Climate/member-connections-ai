import { createConfig } from './config';

describe('createConfig', () => {
  it('should throw error when required environment variables are missing', () => {
    expect(() => createConfig({})).toThrow('Missing required environment variable: SLACK_BOT_TOKEN');
  });

  it('should use default values for optional environment variables', () => {
    const env = {
      SLACK_BOT_TOKEN: 'test-bot-token',
      SLACK_APP_TOKEN: 'test-app-token',
      OPENROUTER_API_KEY: 'test-api-key',
    };

    const config = createConfig(env);
    expect(config.port).toBe(8080);
    expect(config.appUrl).toBe('https://github.com/9Zero-Climate/member-connections-ai');
  });

  it('should use provided environment values', () => {
    const env = {
      SLACK_BOT_TOKEN: 'test-bot-token',
      SLACK_APP_TOKEN: 'test-app-token',
      OPENROUTER_API_KEY: 'test-api-key',
      PORT: '3000',
      APP_URL: 'http://test.com',
    };

    const config = createConfig(env);
    expect(config.port).toBe(3000);
    expect(config.appUrl).toBe('http://test.com');
    expect(config.slackBotToken).toBe('test-bot-token');
    expect(config.slackAppToken).toBe('test-app-token');
    expect(config.openRouterApiKey).toBe('test-api-key');
  });
});
