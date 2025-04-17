import { ConfigContext, createConfig, validateConfig } from './config';

describe('validateConfig', () => {
  it.each([[ConfigContext.Core], [ConfigContext.Migrate], [ConfigContext.SyncAll], [ConfigContext.SyncSlack]])(
    'throws error when required environment variables are missing for context',
    (context) => {
      expect(() => validateConfig({}, context)).toThrow(/^Missing required environment variables for context/);
    },
  );

  it('lists all missing environment variables in error message', () => {
    expect(() => validateConfig({ DB_URL: 'not missing' }, ConfigContext.SyncSlack)).toThrow(
      `Missing required environment variables for context 'sync-slack': OPENAI_API_KEY, SLACK_BOT_TOKEN`,
    );
  });

  it('does not throw error for no-verify context', () => {
    expect(() => validateConfig({}, ConfigContext.NoVerify)).not.toThrow();
  });

  it('does not throw error for valid config', () => {
    expect(() => validateConfig({ DB_URL: 'not missing' }, ConfigContext.Migrate)).not.toThrow();
  });
});

describe('createConfig', () => {
  it('uses default values for optional environment variables', () => {
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

  it('uses provided environment values', () => {
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
