const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

function getConfiguredLevel(): LogLevel {
  const env = process.env.LOG_LEVEL?.toLowerCase();
  if (env && env in LOG_LEVELS) return env as LogLevel;
  return 'info';
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[getConfiguredLevel()];
}

function formatEntry(level: LogLevel, module: string, message: string, context?: Record<string, unknown>): string {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    module,
    message,
  };
  if (context) entry.context = context;
  return JSON.stringify(entry);
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export function createLogger(module: string): Logger {
  const log = (level: LogLevel, message: string, context?: Record<string, unknown>) => {
    if (!shouldLog(level)) return;
    const line = formatEntry(level, module, message, context);
    if (level === 'error') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  };

  return {
    debug: (msg, ctx?) => log('debug', msg, ctx),
    info: (msg, ctx?) => log('info', msg, ctx),
    warn: (msg, ctx?) => log('warn', msg, ctx),
    error: (msg, ctx?) => log('error', msg, ctx),
  };
}
