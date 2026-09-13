import winston from 'winston';
import path from 'path';

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp: ts, component, stack }) => {
  const comp = component ? `[${component}] ` : '';
  return `${ts} ${level}: ${comp}${stack || message}`;
});

export function createLogger(component = 'app') {
  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    defaultMeta: { component },
    format: combine(timestamp(), errors({ stack: true }), logFormat),
    transports: [
      new winston.transports.Console({
        format: combine(colorize(), timestamp(), logFormat),
      }),
      new winston.transports.File({
        filename: path.join('logs', 'combined.log'),
        maxsize: 10 * 1024 * 1024,
        maxFiles: 5,
      }),
      new winston.transports.File({
        filename: path.join('logs', 'error.log'),
        level: 'error',
        maxsize: 10 * 1024 * 1024,
        maxFiles: 5,
      }),
    ],
  });
}

export default createLogger('app');
