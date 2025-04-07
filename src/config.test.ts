import { createConfig } from './config';

describe('createConfig', () => {
  it('should throw error when required environment variables are missing', () => {
    expect(() => createConfig({})).toThrow('Missing required environment variable: SLACK_BOT_TOKEN');
    expect(() => createConfig({ SLACK_BOT_TOKEN: 'b', SLACK_APP_TOKEN: 'a' /* Missing others */ })).toThrow(
      'Missing required environment variable: OPENAI_API_KEY',
    );
  });

  it('should use default values for optional environment variables', () => {
    const env = {
      SLACK_BOT_TOKEN: 'test-bot-token',
      SLACK_APP_TOKEN: 'test-app-token',
      OPENAI_API_KEY: 'test-openai-key',
      OPENROUTER_API_KEY: 'test-router-key',
      OFFICERND_ORG_SLUG: 'test-slug',
      OFFICERND_CLIENT_ID: 'test-id',
      OFFICERND_CLIENT_SECRET: 'test-secret',
      DB_URL: 'test-db-url',
    };

    const config = createConfig(env);
    expect(config.port).toBe(8080);
    expect(config.appUrl).toBe('https://github.com/9Zero-Climate/member-connections-ai');
  });

  it('should use provided environment values', () => {
    const env = {
      SLACK_BOT_TOKEN: 'test-bot-token',
      SLACK_APP_TOKEN: 'test-app-token',
      OPENAI_API_KEY: 'test-openai-key',
      OPENROUTER_API_KEY: 'test-router-key',
      OFFICERND_ORG_SLUG: 'test-slug',
      OFFICERND_CLIENT_ID: 'test-id',
      OFFICERND_CLIENT_SECRET: 'test-secret',
      DB_URL: 'test-db-url',
      PORT: '3000',
      APP_URL: 'http://test.com',
      PROXYCURL_API_KEY: 'test-proxy-key',
    };

    const config = createConfig(env);
    expect(config.port).toBe(3000);
    expect(config.appUrl).toBe('http://test.com');
    expect(config.slackBotToken).toBe('test-bot-token');
    expect(config.slackAppToken).toBe('test-app-token');
    expect(config.openaiApiKey).toBe('test-openai-key');
    expect(config.openRouterApiKey).toBe('test-router-key');
    expect(config.proxycurlApiKey).toBe('test-proxy-key');
  });
});
