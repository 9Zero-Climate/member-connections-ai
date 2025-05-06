import { config as loadEnv } from 'dotenv';
import { logUncaughtErrors, logger } from './services/logger';

// Config contexts determine which config variables are required
export enum ConfigContext {
  Core = 'core',
  SyncAll = 'sync-all',
  SyncOfficeRnD = 'sync-officernd',
  SyncLinkedIn = 'sync-linkedin',
  SyncNotion = 'sync-notion',
  SyncSlack = 'sync-slack',
  Migrate = 'migrate',
  NoVerify = 'no-verify',
}
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

  // Logtail (aka BetterStack Telemetry) configuration
  logtailSourceToken?: string;
  logtailIngestingHost?: string;
}

// Define required variables per context
const REQUIRED_CONFIG_KEYS_FOR_CONTEXT: Record<ConfigContext, (keyof Config)[]> = {
  core: ['slackBotToken', 'slackAppToken', 'openaiApiKey', 'openRouterApiKey', 'dbUrl'],
  migrate: ['dbUrl'],
  'sync-all': [
    'dbUrl',
    'notionApiKey',
    'notionMembersDbId',
    'officerndOrgSlug',
    'officerndClientId',
    'officerndClientSecret',
    'openaiApiKey', // Needed for embeddings
    'proxycurlApiKey', // Assuming proxycurl is needed for linkedin updates during member sync
  ],
  'sync-officernd': [
    'dbUrl',
    'officerndOrgSlug',
    'officerndClientId',
    'officerndClientSecret',
    'openaiApiKey', // Needed for embeddings
  ],
  'sync-linkedin': [
    'dbUrl',
    'openaiApiKey', // Needed for embeddings
    'proxycurlApiKey', // Assuming proxycurl is needed for linkedin updates during member sync
  ],
  'sync-notion': [
    'dbUrl',
    'notionApiKey',
    'notionMembersDbId',
    'openaiApiKey', // Needed for embeddings
  ],
  'sync-slack': [
    'dbUrl',
    'openaiApiKey', // Needed for embeddings
    'slackBotToken', // Needed to interact with Slack API
  ],
  'no-verify': [], // No required vars for test environment
};

// Map config keys to environment variable names
const CONFIG_KEY_TO_ENV_VAR: Record<keyof Config, string> = {
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
  logtailSourceToken: 'LOGTAIL_SOURCE_TOKEN',
  logtailIngestingHost: 'LOGTAIL_INGESTING_HOST',
};

/**
 * Validate that the environment variables required for this config context are present
 */
export function validateConfig(env: NodeJS.ProcessEnv, context: ConfigContext) {
  logger.info('Validating config...');

  const requiredConfigKeys = REQUIRED_CONFIG_KEYS_FOR_CONTEXT[context];
  const requiredEnvVars = requiredConfigKeys.map((requiredConfigKey) => CONFIG_KEY_TO_ENV_VAR[requiredConfigKey]);

  const missingRequiredEnvVars = requiredEnvVars.filter((requiredEnvVar) => !env[requiredEnvVar]);

  if (missingRequiredEnvVars.length > 0) {
    throw new Error(
      `Missing required environment variables for context '${context}': ${missingRequiredEnvVars.join(', ')}')`,
    );
  }
}

export function loadConfig(env: NodeJS.ProcessEnv) {
  // Return config object, attempting to load all values but allowing undefined
  // for those not required by the current context.
  return {
    environment: env.NODE_ENV,
    slackBotToken: env.SLACK_BOT_TOKEN,
    slackAppToken: env.SLACK_APP_TOKEN,
    openaiApiKey: env.OPENAI_API_KEY,
    openRouterApiKey: env.OPENROUTER_API_KEY,
    proxycurlApiKey: env.PROXYCURL_API_KEY,
    modelName: env.OPENROUTER_MODEL_NAME || 'google/gemini-2.0-flash-001',
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
    logtailSourceToken: env.LOGTAIL_SOURCE_TOKEN,
    logtailIngestingHost: env.LOGTAIL_INGESTING_HOST,
  };
}

export function createValidConfig(
  env: NodeJS.ProcessEnv = process.env,
  context: ConfigContext = ConfigContext.Core,
): Config {
  validateConfig(env, context);
  return loadConfig(env);
}

// Entry points should call validateConfig themselves with the appropriate context
// For use in library functions, we provide a default instance without verifying any particular set of variables
// This does make runtime errors possible if we forget to call createConfig with the correct context. But that was possible anyway.
export const config = loadConfig(process.env);
