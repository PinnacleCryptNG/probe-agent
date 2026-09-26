export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  investigationId?: string;
  chatId?: string | number;
  capability?: string;
  chain?: string;
  token?: string;
  durationMs?: number;
  creditCost?: number;
  creditsRemaining?: number;
  [key: string]: unknown;
}

const SENSITIVE_PATTERNS = [
  /apikey/i,
  /api_key/i,
  /bot_token/i,
  /token/i,
  /secret/i,
  /password/i,
  /authorization/i,
];

function sanitize(value: unknown): unknown {
  if (typeof value === 'string') {
    // Redact strings that look like API keys or sensitive hex tokens (unless it's an address)
    if (value.startsWith('nansen_') || (value.length > 30 && !value.startsWith('0x') && !value.includes(' '))) {
      return '[REDACTED_SECRET]';
    }
    return value;
  }
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) {
      return value.map(sanitize);
    }
    const sanitizedObj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const isSensitiveKey = SENSITIVE_PATTERNS.some((pat) => pat.test(k));
      sanitizedObj[k] = isSensitiveKey ? '[REDACTED]' : sanitize(v);
    }
    return sanitizedObj;
  }
  return value;
}

export class Logger {
  constructor(
    private readonly defaultContext: LogContext = {},
    private readonly minLevel: LogLevel = 'info'
  ) {}

  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
    return levels[level] >= levels[this.minLevel];
  }

  private write(level: LogLevel, message: string, context?: LogContext) {
    if (!this.shouldLog(level)) return;

    const mergedContext = {
      ...this.defaultContext,
      ...context,
    };

    const entry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      message,
      ...(Object.keys(mergedContext).length > 0 ? { context: sanitize(mergedContext) } : {}),
    };

    const formatted = JSON.stringify(entry);
    if (level === 'error') {
      console.error(formatted);
    } else if (level === 'warn') {
      console.warn(formatted);
    } else {
      console.log(formatted);
    }
  }

  public debug(message: string, context?: LogContext): void {
    this.write('debug', message, context);
  }

  public info(message: string, context?: LogContext): void {
    this.write('info', message, context);
  }

  public warn(message: string, context?: LogContext): void {
    this.write('warn', message, context);
  }

  public error(message: string, context?: LogContext): void {
    this.write('error', message, context);
  }

  public withContext(context: LogContext): Logger {
    return new Logger({ ...this.defaultContext, ...context }, this.minLevel);
  }
}

export const logger = new Logger();
