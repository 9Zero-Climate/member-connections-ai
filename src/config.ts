import { config as loadEnv } from 'dotenv';
import { logUncaughtErrors, logger } from './services/logger';

// Config contexts determine which config variables are required
type ConfigContext = 'core' | 'member-sync' | 'slack-sync' | 'test' | 'migrate';

// Setup things that tend to mess up the test environment
// -> skip them on test environment
if (process.env.NODE_ENV !== 'test') {
  // This needs to happen before anything that might throw an uncaught exception.
  logUncaughtErrors(logger);
  loadEnv();
}

// Many of these are optional at the top level, but required for specific contexts
export interface Config {
  // Slack configuration
  slackBotToken?: string;
  slackAppToken?: string;

  // OpenAI configuration (for embeddings)
  openaiApiKey?: string;

  // OpenRouter configuration (for chat)
  openRouterApiKey?: string;
  modelName: string;
  openRouterBaseUrl: string;
  appName: string;
  appUrl: string;

  // Proxycurl configuration (for Linkedin profile scraping)
  proxycurlApiKey?: string;

  // Server configuration
  port: number;
  dbUrl?: string;
  environment?: string;

  // OfficeRnD configuration
  officerndOrgSlug?: string;
  officerndClientId?: string;
  officerndClientSecret?: string;

  // Assistant configuration
  maxMessageLength: number;
  maxToolCallIterations: number;
  chatEditIntervalMs: number;

  // Notion configuration
  notionApiKey?: string;
  notionMembersDbId?: string;
}

export function createConfig(env: NodeJS.ProcessEnv = process.env, context: ConfigContext = 'core'): Config {
  // Define required variables per context
  const requiredVarsMap: Record<ConfigContext, (keyof Config)[]> = {
    core: ['slackBotToken', 'slackAppToken', 'openaiApiKey', 'openRouterApiKey', 'dbUrl'],
    migrate: ['dbUrl'],
    'member-sync': [
      'dbUrl',
      'officerndOrgSlug',
      'officerndClientId',
      'officerndClientSecret',
      'proxycurlApiKey', // Assuming proxycurl is needed for linkedin updates during member sync
      'notionApiKey',
      'notionMembersDbId',
      'openaiApiKey', // Needed for embeddings
    ],
    'slack-sync': [
      'slackBotToken', // Needed to interact with Slack API
      'dbUrl',
      'openaiApiKey', // Needed for embeddings
    ],
    test: [], // No required vars for test environment
  };

  // Map config keys to environment variable names
  const envVarMap: Record<keyof Config, string> = {
    slackBotToken: 'SLACK_BOT_TOKEN',
    slackAppToken: 'SLACK_APP_TOKEN',
    openaiApiKey: 'OPENAI_API_KEY',
    openRouterApiKey: 'OPENROUTER_API_KEY',
    modelName: 'OPENROUTER_MODEL_NAME',
    openRouterBaseUrl: 'OPENROUTER_BASE_URL',
    appName: 'APP_NAME',
    appUrl: 'APP_URL',
    proxycurlApiKey: 'PROXYCURL_API_KEY',
    port: 'PORT',
    dbUrl: 'DB_URL',
    environment: 'NODE_ENV',
    officerndOrgSlug: 'OFFICERND_ORG_SLUG',
    officerndClientId: 'OFFICERND_CLIENT_ID',
    officerndClientSecret: 'OFFICERND_CLIENT_SECRET',
    maxMessageLength: 'MAX_MESSAGE_LENGTH', // These might not be env vars, adjust if needed
    maxToolCallIterations: 'MAX_TOOL_CALL_ITERATIONS',
    chatEditIntervalMs: 'CHAT_EDIT_INTERVAL_MS',
    notionApiKey: 'NOTION_API_KEY',
    notionMembersDbId: 'NOTION_MEMBERS_DATABASE_ID',
  };

  // Get the required variables for the current context
  const requiredConfigKeys = requiredVarsMap[context] || [];

  // Validate required variables for the current context
  for (const configKey of requiredConfigKeys) {
    const envVarName = envVarMap[configKey];
    if (!env[envVarName]) {
      throw new Error(
        `Missing required environment variable for context '${context}': ${envVarName} (mapped from config key '${configKey}')`,
      );
    }
  }

  // Return config object, attempting to load all values but allowing undefined
  // for those not required by the current context.
  return {
    environment: env.NODE_ENV,
    slackBotToken: env.SLACK_BOT_TOKEN,
    slackAppToken: env.SLACK_APP_TOKEN,
    openaiApiKey: env.OPENAI_API_KEY,
    openRouterApiKey: env.OPENROUTER_API_KEY,
    proxycurlApiKey: env.PROXYCURL_API_KEY,
    modelName: env.OPENROUTER_MODEL_NAME || 'google/gemini-flash-1.5', // Updated default model
    openRouterBaseUrl: env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    appName: env.APP_NAME || 'Member Connections AI',
    appUrl: env.APP_URL || 'https://github.com/9Zero-Climate/member-connections-ai',
    port: Number.parseInt(env.PORT || '8080', 10),
    dbUrl: env.DB_URL,
    officerndOrgSlug: env.OFFICERND_ORG_SLUG,
    officerndClientId: env.OFFICERND_CLIENT_ID,
    officerndClientSecret: env.OFFICERND_CLIENT_SECRET,
    // Provide defaults for non-env var config or ensure they are not in required lists if not env vars
    maxMessageLength: Number.parseInt(env.MAX_MESSAGE_LENGTH || '3900', 10),
    maxToolCallIterations: Number.parseInt(env.MAX_TOOL_CALL_ITERATIONS || '5', 10),
    chatEditIntervalMs: Number.parseInt(env.CHAT_EDIT_INTERVAL_MS || '1000', 10),
    notionApiKey: env.NOTION_API_KEY,
    notionMembersDbId: env.NOTION_MEMBERS_DATABASE_ID,
  };
}

// Export a default instance potentially for the main app context, or require explicit context elsewhere.
// Consider if a default export is appropriate or if all callers should specify context.
export const config = createConfig(process.env, 'core');
