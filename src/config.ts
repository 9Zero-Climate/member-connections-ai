import { config as loadEnv } from 'dotenv';
import { logUncaughtErrors, logger } from './services/logger';

// Setup things that tend to mess up the test environment
// -> skip them on test environment
if (process.env.NODE_ENV !== 'test') {
  // This needs to happen before anything that might throw an uncaught exception.
  logUncaughtErrors(logger);
  loadEnv();
}

export interface Config {
  // Slack configuration
  slackBotToken: string;
  slackAppToken: string;

  // OpenAI configuration (for embeddings)
  openaiApiKey: string;

  // OpenRouter configuration (for chat)
  openRouterApiKey: string;
  modelName: string;
  openRouterBaseUrl: string;
  appName: string;
  appUrl: string;

  // Proxycurl configuration (for Linkedin profile scraping)
  proxycurlApiKey?: string;

  // Server configuration
  port: number;
  dbUrl: string;
  environment: string;
  // OfficeRnD configuration
  officerndOrgSlug: string;
  officerndClientId: string;
  officerndClientSecret: string;

  // Assistant configuration
  maxMessageLength: number;
  maxToolCallIterations: number;
  chatEditIntervalMs: number;
}

export function createConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const requiredVars = [
    'SLACK_BOT_TOKEN',
    'SLACK_APP_TOKEN',
    'OPENAI_API_KEY',
    'OPENROUTER_API_KEY',
    'OFFICERND_ORG_SLUG',
    'OFFICERND_CLIENT_ID',
    'OFFICERND_CLIENT_SECRET',
    'DB_URL',
  ];
  for (const varName of requiredVars) {
    if (!env[varName]) {
      throw new Error(`Missing required environment variable: ${varName}`);
    }
  }

  return {
    environment: env.NODE_ENV,
    slackBotToken: env.SLACK_BOT_TOKEN as string,
    slackAppToken: env.SLACK_APP_TOKEN as string,
    openaiApiKey: env.OPENAI_API_KEY as string,
    openRouterApiKey: env.OPENROUTER_API_KEY as string,
    proxycurlApiKey: env.PROXYCURL_API_KEY,
    modelName: env.OPENROUTER_MODEL_NAME || 'google/gemini-2.0-flash-001',
    openRouterBaseUrl: env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    appName: env.APP_NAME || 'Member Connections AI',
    appUrl: env.APP_URL || 'https://github.com/9Zero-Climate/member-connections-ai',
    port: Number.parseInt(env.PORT || '8080', 10),
    dbUrl: env.DB_URL as string,
    officerndOrgSlug: env.OFFICERND_ORG_SLUG as string,
    officerndClientId: env.OFFICERND_CLIENT_ID as string,
    officerndClientSecret: env.OFFICERND_CLIENT_SECRET as string,
    maxMessageLength: 3900,
    maxToolCallIterations: 5,
    chatEditIntervalMs: 1000,
  };
}

export const config = createConfig();
