import { App } from '@slack/bolt';
import express from 'express';
import type { Express } from 'express';
import { registerAssistantAndHandlers } from './assistant';
import { config } from './config';
import { boltLogger, logUncaughtErrors, logger } from './services/logger';
import { handleCheckinEvent } from './services/officernd';

logUncaughtErrors(logger);

// Setup Slack Bolt App
const app = new App({
  token: config.slackBotToken,
  appToken: config.slackAppToken,
  socketMode: true,
  logger: boltLogger,
});

// Create an Express app for health checks & webhooks
const expressApp: Express = express();
expressApp.use(express.json());

// Health check endpoint
expressApp.get('/', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

/* Handle checkin webhooks from OfficeRND
Expected payload documented at https://developer.officernd.com/docs/webhooks-getting-started#receiving-webhook-notifications
*/
expressApp.post('/sync-officernd-checkin', async (req, res) => {
  const { body } = req;
  logger.info({ body }, 'Handling sync-checkin webhook');

  try {
    await handleCheckinEvent(body);
  } catch (error) {
    logger.error(error);
    res.status(400).send((error as Error).message);
  }

  res.status(200).send('Checkin synced');
});

// Start the Express server
expressApp.listen(config.port, () => {
  logger.info({ port: config.port }, '🩺 HTTP server started');
});

// Hook the chatbot into the Slack Bolt app
registerAssistantAndHandlers(app, config, app.client);

// Start the Slack app
(async () => {
  await app.start();
  logger.info(
    {
      env: process.env.NODE_ENV,
      socketMode: true,
    },
    '⚡️ Bolt app started',
  );
})();
