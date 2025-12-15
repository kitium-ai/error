import { vi } from 'vitest';

// Mock the logger module to avoid the broken import chain
vi.mock('@kitiumai/logger', () => {
  // Create a simple mock logger implementation
  class SimpleMockLogger {
    private logs: Array<{ level: string; message: string; meta?: unknown }> = [];

    debug(message: string, meta?: unknown) {
      this.logs.push({ level: 'debug', message, meta });
    }

    info(message: string, meta?: unknown) {
      this.logs.push({ level: 'info', message, meta });
    }

    warn(message: string, meta?: unknown) {
      this.logs.push({ level: 'warn', message, meta });
    }

    error(message: string, meta?: unknown) {
      this.logs.push({ level: 'error', message, meta });
    }

    fatal(message: string, meta?: unknown) {
      this.logs.push({ level: 'fatal', message, meta });
    }

    getLogs() {
      return this.logs;
    }

    clearLogs() {
      this.logs = [];
    }
  }

  const defaultLogger = new SimpleMockLogger();

  return {
    getLogger: () => defaultLogger,
    createIsolatedMockLogger: () => {
      const logger = new SimpleMockLogger();
      return {
        logger,
        getLogs: () => logger.getLogs(),
      };
    },
  };
});
