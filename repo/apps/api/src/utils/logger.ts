import { config } from '../config';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: LogLevel): boolean {
  const configured = (config.logLevel as LogLevel) || 'info';
  return LEVEL_ORDER[level] >= (LEVEL_ORDER[configured] ?? 1);
}

function emit(level: LogLevel, domain: string, fields: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  const entry = JSON.stringify({
    level,
    domain,
    ...fields,
    timestamp: new Date().toISOString(),
  });

  if (level === 'error') {
    console.error(entry);
  } else {
    console.log(entry);
  }
}

export const logger = {
  debug(domain: string, fields: Record<string, unknown>) { emit('debug', domain, fields); },
  info(domain: string, fields: Record<string, unknown>) { emit('info', domain, fields); },
  warn(domain: string, fields: Record<string, unknown>) { emit('warn', domain, fields); },
  error(domain: string, fields: Record<string, unknown>) { emit('error', domain, fields); },
};
