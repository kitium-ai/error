/* eslint-disable max-lines-per-function, sonarjs/no-duplicate-string */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KitiumError, logError, resetErrorMetrics } from './index';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

type LogEntry = {
  level: LogLevel;
  message: string;
  meta?: unknown;
};

type MockLoggerInstance = {
  logger: {
    error: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
  };
  getLogs: () => readonly LogEntry[];
};

function createMockLogger(): MockLoggerInstance {
  const logs: LogEntry[] = [];

  const push = (level: LogLevel, message: unknown, meta: unknown): void => {
    logs.push({
      level,
      message: typeof message === 'string' ? message : String(message),
      meta,
    });
  };

  return {
    logger: {
      error: (message: unknown, meta?: unknown) => push('error', message, meta),
      warn: (message: unknown, meta?: unknown) => push('warn', message, meta),
      info: (message: unknown, meta?: unknown) => push('info', message, meta),
      debug: (message: unknown, meta?: unknown) => push('debug', message, meta),
    },
    getLogs: () => logs,
  };
}

vi.mock('@kitiumai/logger', () => {
  return {
    getLogger: vi.fn(),
  };
});

describe('Error Logging', () => {
  let mockLoggerInstance: ReturnType<typeof createMockLogger>;
  let getLoggerMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    resetErrorMetrics();
    mockLoggerInstance = createMockLogger();

    const loggerModule = await import('@kitiumai/logger');
    getLoggerMock = loggerModule.getLogger as unknown as ReturnType<typeof vi.fn>;
    getLoggerMock.mockReturnValue(mockLoggerInstance.logger);
  });

  it('should log fatal errors with error method', () => {
    const error = new KitiumError({
      code: 'test/fatal',
      message: 'Fatal error',
      severity: 'fatal',
      kind: 'internal',
      retryable: false,
      statusCode: 500,
    });

    logError(error);

    const logs = mockLoggerInstance.getLogs();
    const errorLogs = logs.filter((log) => log.level === 'error');
    expect(errorLogs).toHaveLength(1);
    expect(errorLogs[0]?.message).toBe('Fatal error');
    const meta = errorLogs[0]?.meta as Record<string, unknown> | undefined;
    expect(meta).toBeDefined();
    expect(meta?.['code']).toBe('test/fatal');
    expect(meta?.['severity']).toBe('fatal');
    expect(meta?.['retryable']).toBe(false);
    expect(meta?.['statusCode']).toBe(500);
  });

  it('should log errors with error method', () => {
    const error = new KitiumError({
      code: 'test/error',
      message: 'Error message',
      severity: 'error',
      kind: 'internal',
      retryable: false,
    });

    logError(error);

    const logs = mockLoggerInstance.getLogs();
    const errorLogs = logs.filter((log) => log.level === 'error');
    expect(errorLogs).toHaveLength(1);
    expect(errorLogs[0]?.message).toBe('Error message');
  });

  it('should log warnings with warn method', () => {
    const error = new KitiumError({
      code: 'test/warning',
      message: 'Warning message',
      severity: 'warning',
      kind: 'validation',
      retryable: false,
    });

    logError(error);

    const logs = mockLoggerInstance.getLogs();
    const warnLogs = logs.filter((log) => log.level === 'warn');
    expect(warnLogs).toHaveLength(1);
    expect(warnLogs[0]?.message).toBe('Warning message');
  });

  it('should log info with info method', () => {
    const error = new KitiumError({
      code: 'test/info',
      message: 'Info message',
      severity: 'info',
      kind: 'business',
      retryable: false,
    });

    logError(error);

    const logs = mockLoggerInstance.getLogs();
    const infoLogs = logs.filter((log) => log.level === 'info');
    expect(infoLogs).toHaveLength(1);
    expect(infoLogs[0]?.message).toBe('Info message');
  });

  it('should log debug with debug method', () => {
    const error = new KitiumError({
      code: 'test/debug',
      message: 'Debug message',
      severity: 'debug',
      kind: 'internal',
      retryable: false,
    });

    logError(error);

    const logs = mockLoggerInstance.getLogs();
    const debugLogs = logs.filter((log) => log.level === 'debug');
    expect(debugLogs).toHaveLength(1);
    expect(debugLogs[0]?.message).toBe('Debug message');
  });

  it('should include all relevant error properties in payload', () => {
    const error = new KitiumError({
      code: 'test/complete',
      message: 'Complete error',
      severity: 'error',
      kind: 'dependency',
      retryable: true,
      statusCode: 502,
      retryDelay: 1000,
      maxRetries: 3,
      backoff: 'exponential',
      source: 'api-service',
      schemaVersion: '1.0.0',
      lifecycle: 'active',
    });

    logError(error);

    const logs = mockLoggerInstance.getLogs();
    const errorLogs = logs.filter((log) => log.level === 'error');
    const meta = errorLogs[0]?.meta as Record<string, unknown> | undefined;
    expect(meta).toMatchObject({
      code: 'test/complete',
      message: 'Complete error',
      severity: 'error',
      retryable: true,
      statusCode: 502,
      retryDelay: 1000,
      maxRetries: 3,
      backoff: 'exponential',
      source: 'api-service',
      schemaVersion: '1.0.0',
      lifecycle: 'active',
    });
  });

  it('should redact sensitive context fields', () => {
    const error = new KitiumError({
      code: 'test/sensitive',
      message: 'Error with sensitive data',
      severity: 'error',
      kind: 'internal',
      retryable: false,
      context: {
        correlationId: 'corr-123',
        requestId: 'req-456',
        userId: '123',
        password: 'secret',
        apiKey: 'key-123',
      },
      redact: ['password', 'apiKey'],
    });

    logError(error);

    const logs = mockLoggerInstance.getLogs();
    const errorLogs = logs.filter((log) => log.level === 'error');
    const meta = errorLogs[0]?.meta as Record<string, unknown> | undefined;
    const context = meta?.['context'] as Record<string, unknown> | undefined;
    expect(context).toEqual({
      userId: '123',
      password: '[REDACTED]',
      apiKey: '[REDACTED]',
    });
  });

  it('should include fingerprint in logged payload', () => {
    const error = new KitiumError({
      code: 'test/fingerprint',
      message: 'Error with fingerprint',
      severity: 'error',
      kind: 'validation',
      retryable: false,
    });

    logError(error);

    const logs = mockLoggerInstance.getLogs();
    const errorLogs = logs.filter((log) => log.level === 'error');
    const meta = errorLogs[0]?.meta as Record<string, unknown> | undefined;
    expect(meta?.['fingerprint']).toBe('test/fingerprint:validation');
  });

  it('should handle nested context redaction', () => {
    const error = new KitiumError({
      code: 'test/nested',
      message: 'Error with nested sensitive data',
      severity: 'error',
      kind: 'internal',
      retryable: false,
      context: {
        correlationId: 'corr-123',
        requestId: 'req-456',
        user: {
          id: '123',
          credentials: {
            password: 'secret',
            token: 'token-123',
          },
        },
      },
      redact: ['user.credentials.password', 'user.credentials.token'],
    });

    logError(error);

    const logs = mockLoggerInstance.getLogs();
    const errorLogs = logs.filter((log) => log.level === 'error');
    const meta = errorLogs[0]?.meta as Record<string, unknown> | undefined;
    const context = meta?.['context'] as Record<string, unknown> | undefined;
    expect(context).toEqual({
      user: {
        id: '123',
        credentials: {
          password: '[REDACTED]',
          token: '[REDACTED]',
        },
      },
    });
  });
});
