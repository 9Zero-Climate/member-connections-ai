import type { Logger as BoltLogger, LogLevel } from '@slack/bolt';
import * as dotenv from 'dotenv';
import pino, { type Logger } from 'pino';

dotenv.config();

// Base Pino logger configuration
const pinoLogger = pino({
  level: 'debug',
  // By default, Pino logs the level as a number. That's nice for ordering, but
  // annoying for human consumption. Use labels instead.
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  base: {
    app: 'member-connections-ai',
    env: process.env.NODE_ENV || 'production',
  },
  // Customize the timestamp format
  timestamp: pino.stdTimeFunctions.isoTime,
  // Redact sensitive information
  redact: ['req.headers.authorization', '*.password', '*.token', '*.key'],
  // Enable caller info tracking
  mixin: () => {
    // Get the caller info by creating an Error and parsing its stack
    const stack = new Error().stack;
    if (!stack) return {};

    // Parse the stack to get file and line info
    // Skip first few lines (pino internals)
    // Find first stack frame not from node internals or node_modules
    const stackFrames = stack.split('\n');
    const caller = stackFrames.find((frame) => {
      return (
        !frame.includes('node:internal') &&
        !frame.includes('node_modules') &&
        !frame.includes('logger.ts') &&
        frame.trim().startsWith('at ')
      );
    });
    if (!caller) return {};
    // Extract function name and file location
    // Example stack line: "    at functionName (/path/to/file.ts:123:45)"
    // or "    at Object.functionName (/path/to/file.ts:123:45)"
    // or "    at /path/to/file.ts:123:45"
    const functionMatch = caller.match(/at (?:(?:Object\.)?([\w.<>]+) )?.*?\((.+:\d+:\d+)\)$/);
    if (!functionMatch) return {};

    const [, fnName = '<anonymous>', callerLocation] = functionMatch;

    return {
      callerLocation,
      caller: fnName,
    };
  },
});

let loggingUncaughtErrors = false;

const logUncaughtErrors = (logger: Logger) => {
  if (loggingUncaughtErrors) return;
  loggingUncaughtErrors = true;
  process.on('uncaughtException', (err) => {
    logger.fatal(err, 'uncaught exception detected');
  });
};

// Create a Bolt-compatible logger that will send messages into a child logger
// We're using a child logger here so that we can control log level separately
// for Bolt and for the rest of the app
const pinoLoggerForBolt = pinoLogger.child({ module: 'bolt' });

type pinoLoggingArgs = Parameters<Logger['debug']>;

const boltLogger: BoltLogger = {
  debug(...msg: pinoLoggingArgs): void {
    pinoLoggerForBolt.debug(...msg);
  },
  info(...msg: pinoLoggingArgs): void {
    pinoLoggerForBolt.info(...msg);
  },
  warn(...msg: pinoLoggingArgs): void {
    pinoLoggerForBolt.warn(...msg);
  },
  error(...msg: pinoLoggingArgs): void {
    pinoLoggerForBolt.error(...msg);
  },
  setLevel(level: string): void {
    pinoLoggerForBolt.level = level;
  },
  getLevel(): LogLevel {
    return pinoLoggerForBolt.level as LogLevel;
  },
  setName(name: string): void {
    pinoLoggerForBolt.info({ name }, 'Logger name set');
  },
};

export { boltLogger, pinoLogger as logger, logUncaughtErrors };
