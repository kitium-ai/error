export type ErrorSeverity = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

export type ErrorKind =
  | 'business'
  | 'validation'
  | 'auth'
  | 'rate_limit'
  | 'not_found'
  | 'conflict'
  | 'dependency'
  | 'internal'
  | (string & {});

export type ErrorLifecycle = 'draft' | 'active' | 'deprecated';

export type RetryBackoff = 'linear' | 'exponential' | 'fixed';

export type RetryInfo = {
  readonly retryable: boolean;
  readonly retryDelay?: number;
  readonly maxRetries?: number;
  readonly backoff?: RetryBackoff;
};

export type ErrorContext = {
  readonly correlationId?: string;
  readonly requestId?: string;
  readonly spanId?: string;
  readonly tenantId?: string;
  readonly userId?: string;
  readonly [key: string]: unknown;
};

export type ErrorShape = {
  readonly code: string;
  readonly message: string;
  readonly statusCode?: number;
  readonly severity: ErrorSeverity;
  readonly kind: ErrorKind;
  readonly lifecycle?: ErrorLifecycle;
  readonly schemaVersion?: string;
  readonly retryable: boolean;
  readonly retryDelay?: number;
  readonly maxRetries?: number;
  readonly backoff?: RetryBackoff;
  readonly help?: string;
  readonly docs?: string;
  readonly source?: string;
  readonly userMessage?: string;
  readonly i18nKey?: string;
  readonly redact?: string[];
  readonly context?: ErrorContext;
  readonly cause?: unknown;
};

export type ProblemDetails = {
  readonly type?: string;
  readonly title: string;
  readonly status?: number;
  readonly detail?: string;
  readonly instance?: string;
  readonly extensions?: Record<string, unknown>;
};

export type ErrorRegistryEntry = ErrorShape & {
  readonly fingerprint?: string;
  readonly toProblem?: (error: ErrorShape) => ProblemDetails;
};

export type ErrorRegistry = {
  register: (entry: ErrorRegistryEntry) => void;
  resolve: (code: string) => ErrorRegistryEntry | undefined;
  toProblemDetails: (error: ErrorShape) => ProblemDetails;
};

export type ErrorMetrics = {
  readonly totalErrors: number;
  readonly errorsByKind: Record<ErrorKind, number>;
  readonly errorsBySeverity: Record<ErrorSeverity, number>;
  readonly retryableErrors: number;
  readonly nonRetryableErrors: number;
};

export type RetryOutcome<T> = {
  readonly attempts: number;
  readonly result?: T;
  readonly error?: unknown;
  readonly lastDelayMs?: number;
};

export type RetryOptions = {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly backoff?: RetryBackoff;
  readonly onAttempt?: (attempt: number, error: ErrorShape) => void;
};

export type TraceSpanLike = {
  setAttribute: (key: string, value: unknown) => void;
  recordException: (exception: unknown) => void;
  setStatus: (status: { code: number; message?: string }) => void;
};
