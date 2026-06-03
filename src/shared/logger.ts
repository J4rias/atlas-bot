import pino from 'pino';
import { config } from './config/index.js';

export const logger = pino({
  level: config.isDev ? 'debug' : 'info',
  transport: config.isDev
    ? { target: 'pino/file', options: { destination: 1 } }
    : undefined,
});

/** Create a child logger scoped to a mode. */
export function createLogger(mode: 'consultant' | 'manager') {
  return logger.child({ mode });
}
