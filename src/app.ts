import { App } from '@slack/bolt';
import express from 'express';
import type { Express } from 'express';
import { getAssistant } from './assistant';
import { config } from './config';
import { boltLogger, logger } from './services/logger';

// Setup Slack Bolt App
const app = new App({
  token: config.slackBotToken,
  appToken: config.slackAppToken,
  socketMode: true,
  logger: boltLogger,
});

// Create an Express app for health checks
const expressApp: Express = express();

// Health check endpoint
expressApp.get('/', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Start the Express server
expressApp.listen(config.port, () => {
  logger.info({ msg: 'Health check server started', port: config.port });
});

// This is the main assistant that will be used to handle messages
app.assistant(getAssistant(config, app.client));

// Start the Slack app
(async () => {
  await app.start();
  logger.info({
    msg: '⚡️ Bolt app started',
    env: process.env.NODE_ENV,
    socketMode: true,
  });
})();
