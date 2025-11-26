export type ErrorSeverity = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

export type ErrorKind =
  | 'business'
  | 'validation'
  | 'auth'
  | 'rate_limit'
  | 'not_found'
  | 'conflict'
  | 'dependency'
  | 'internal';

export type RetryBackoff = 'linear' | 'exponential' | 'fixed';

export interface RetryInfo {
  readonly retryable: boolean;
  readonly retryDelay?: number;
  readonly maxRetries?: number;
  readonly backoff?: RetryBackoff;
}

export interface ErrorContext {
  readonly correlationId?: string;
  readonly requestId?: string;
  readonly spanId?: string;
  readonly tenantId?: string;
  readonly userId?: string;
  readonly [key: string]: unknown;
}

export interface ErrorShape {
  readonly code: string;
  readonly message: string;
  readonly statusCode?: number;
  readonly severity: ErrorSeverity;
  readonly kind: ErrorKind;
  readonly retryable: boolean;
  readonly retryDelay?: number;
  readonly maxRetries?: number;
  readonly backoff?: RetryBackoff;
  readonly help?: string;
  readonly docs?: string;
  readonly source?: string;
  readonly context?: ErrorContext;
  readonly cause?: unknown;
}

export interface ProblemDetails {
  readonly type?: string;
  readonly title: string;
  readonly status?: number;
  readonly detail?: string;
  readonly instance?: string;
  readonly extensions?: Record<string, unknown>;
}

export interface ErrorRegistryEntry extends ErrorShape {
  readonly fingerprint?: string;
  readonly toProblem?: (error: ErrorShape) => ProblemDetails;
}

export interface ErrorRegistry {
  register(entry: ErrorRegistryEntry): void;
  resolve(code: string): ErrorRegistryEntry | undefined;
  toProblemDetails(error: ErrorShape): ProblemDetails;
}

export interface ErrorMetrics {
  readonly totalErrors: number;
  readonly errorsByKind: Record<ErrorKind, number>;
  readonly errorsBySeverity: Record<ErrorSeverity, number>;
  readonly retryableErrors: number;
  readonly nonRetryableErrors: number;
}
