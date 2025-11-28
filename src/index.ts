import { getLogger } from '@kitiumai/logger';
import {
  ErrorKind,
  ErrorRegistry,
  ErrorRegistryEntry,
  ErrorSeverity,
  ErrorShape,
  ProblemDetails,
  ErrorContext,
  ErrorMetrics,
  RetryBackoff,
  RetryOutcome,
  RetryOptions,
  TraceSpanLike,
} from './types';

const DEFAULT_DOCS_URL = 'https://docs.kitium.ai/errors';
const log = getLogger();

/**
 * Type guard to check if value is a plain object
 * @param value - Value to check
 * @returns true if value is a plain object
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneValue<T>(value: T): T {
  return isObject(value) ? (JSON.parse(JSON.stringify(value)) as T) : value;
}

function redactValueAtPath(
  target: Record<string, unknown>,
  path: string[],
  redaction: string
): void {
  const [head, ...tail] = path;
  if (!head) {
    return;
  }

  if (!(head in target)) {
    return;
  }
  if (tail.length === 0) {
    target[head] = redaction;
    return;
  }

  const next = target[head];
  if (isObject(next)) {
    redactValueAtPath(next, tail, redaction);
  }
}

function applyRedactions(
  context: ErrorContext | undefined,
  redactPaths: string[] | undefined,
  redaction = '[REDACTED]'
): ErrorContext | undefined {
  if (!context || !redactPaths?.length) {
    return context;
  }
  const clone = cloneValue(context);
  redactPaths.forEach((path) => redactValueAtPath(clone, path.split('.'), redaction));
  return clone;
}

// Error code validation pattern: lowercase alphanumeric with underscores and forward slashes
// Examples: "auth/forbidden", "validation/required_field", "internal/server_error"
const ERROR_CODE_PATTERN = /^[a-z0-9_]+(\/[a-z0-9_]+)*$/;

// Error metrics tracking
const errorMetrics: {
  totalErrors: number;
  errorsByKind: Record<ErrorKind, number>;
  errorsBySeverity: Record<ErrorSeverity, number>;
  retryableErrors: number;
  nonRetryableErrors: number;
} = {
  totalErrors: 0,
  errorsByKind: {
    business: 0,
    validation: 0,
    auth: 0,
    rate_limit: 0,
    not_found: 0,
    conflict: 0,
    dependency: 0,
    internal: 0,
  },
  errorsBySeverity: {
    fatal: 0,
    error: 0,
    warning: 0,
    info: 0,
    debug: 0,
  },
  retryableErrors: 0,
  nonRetryableErrors: 0,
};

/**
 * Validates error code format
 * @param code - Error code to validate
 * @returns true if valid, false otherwise
 */
export function isValidErrorCode(code: string): boolean {
  return ERROR_CODE_PATTERN.test(code);
}

/**
 * Validates error code and throws if invalid
 * @param code - Error code to validate
 * @throws Error if code format is invalid
 */
export function validateErrorCode(code: string): void {
  if (!isValidErrorCode(code)) {
    throw new Error(
      `Invalid error code format: "${code}". Error codes must match pattern: ${ERROR_CODE_PATTERN.source}. Examples: "auth/forbidden", "validation/required_field"`
    );
  }
}

function validateLifecycle(lifecycle: ErrorShape['lifecycle'] | undefined): void {
  if (!lifecycle) {
    return;
  }
  if (!['draft', 'active', 'deprecated'].includes(lifecycle)) {
    throw new Error(`Invalid lifecycle state: ${lifecycle}. Allowed: draft | active | deprecated.`);
  }
}

export class KitiumError extends Error implements ErrorShape {
  readonly code: string;
  readonly statusCode?: number;
  readonly severity: ErrorSeverity;
  readonly kind: ErrorKind;
  readonly lifecycle?: ErrorShape['lifecycle'];
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

  constructor(shape: ErrorShape, validateCode = true) {
    super(shape.message);
    this.name = 'KitiumError';

    if (validateCode) {
      validateErrorCode(shape.code);
    }
    validateLifecycle(shape.lifecycle);

    this.code = shape.code;
    this.statusCode = shape.statusCode;
    this.severity = shape.severity;
    this.kind = shape.kind;
    this.lifecycle = shape.lifecycle;
    this.schemaVersion = shape.schemaVersion;
    this.retryable = shape.retryable;
    this.retryDelay = shape.retryDelay;
    this.maxRetries = shape.maxRetries;
    this.backoff = shape.backoff;
    this.help = shape.help;
    this.docs = shape.docs;
    this.source = shape.source;
    this.userMessage = shape.userMessage;
    this.i18nKey = shape.i18nKey;
    this.redact = shape.redact;
    this.context = shape.context;
    this.cause = shape.cause;

    // Update metrics
    errorMetrics.totalErrors++;
    errorMetrics.errorsByKind[this.kind]++;
    errorMetrics.errorsBySeverity[this.severity]++;
    if (this.retryable) {
      errorMetrics.retryableErrors++;
    } else {
      errorMetrics.nonRetryableErrors++;
    }
  }

  toJSON(): ErrorShape {
    return {
      code: this.code,
      message: this.message,
      ...(this.statusCode !== undefined ? { statusCode: this.statusCode } : {}),
      severity: this.severity,
      kind: this.kind,
      ...(this.lifecycle !== undefined ? { lifecycle: this.lifecycle } : {}),
      ...(this.schemaVersion !== undefined ? { schemaVersion: this.schemaVersion } : {}),
      retryable: this.retryable,
      ...(this.retryDelay !== undefined ? { retryDelay: this.retryDelay } : {}),
      ...(this.maxRetries !== undefined ? { maxRetries: this.maxRetries } : {}),
      ...(this.backoff !== undefined ? { backoff: this.backoff } : {}),
      ...(this.help !== undefined ? { help: this.help } : {}),
      ...(this.docs !== undefined ? { docs: this.docs } : {}),
      ...(this.source !== undefined ? { source: this.source } : {}),
      ...(this.userMessage !== undefined ? { userMessage: this.userMessage } : {}),
      ...(this.i18nKey !== undefined ? { i18nKey: this.i18nKey } : {}),
      ...(this.redact !== undefined ? { redact: this.redact } : {}),
      ...(this.context !== undefined
        ? { context: applyRedactions(this.context, this.redact) }
        : {}),
      ...(this.cause !== undefined ? { cause: this.cause } : {}),
    };
  }
}

export function createErrorRegistry(defaults?: Partial<ErrorRegistryEntry>): ErrorRegistry {
  const entries = new Map<string, ErrorRegistryEntry>();

  const toProblemDetails = (error: ErrorShape): ProblemDetails => {
    const entry = entries.get(error.code) ?? defaults;
    const redactions = error.redact ?? entry?.redact;
    const context = applyRedactions(error.context, redactions);
    const typeUrl = entry?.docs ?? error.docs ?? `${DEFAULT_DOCS_URL}/${error.code}`;
    const status = error.statusCode ?? entry?.statusCode;
    const userMessage = error.userMessage ?? entry?.userMessage;
    const lifecycle = error.lifecycle ?? entry?.lifecycle;

    if (entry?.toProblem) {
      return entry.toProblem(error);
    }

    return {
      type: typeUrl,
      title: userMessage ?? error.message,
      ...(status !== undefined ? { status } : {}),
      ...(error.help !== undefined ? { detail: error.help } : {}),
      ...((error.context?.correlationId ?? error.context?.requestId)
        ? { instance: error.context?.correlationId ?? error.context?.requestId }
        : {}),
      extensions: {
        code: error.code,
        severity: error.severity,
        retryable: error.retryable,
        ...(lifecycle !== undefined ? { lifecycle } : {}),
        ...(error.schemaVersion !== undefined ? { schemaVersion: error.schemaVersion } : {}),
        ...(error.retryDelay !== undefined ? { retryDelay: error.retryDelay } : {}),
        ...(error.maxRetries !== undefined ? { maxRetries: error.maxRetries } : {}),
        ...(error.backoff !== undefined ? { backoff: error.backoff } : {}),
        kind: error.kind,
        ...(context !== undefined ? { context } : {}),
        ...(userMessage !== undefined ? { userMessage } : {}),
        ...((error.i18nKey ?? entry?.i18nKey) ? { i18nKey: error.i18nKey ?? entry?.i18nKey } : {}),
        ...((error.source ?? entry?.source) ? { source: error.source ?? entry?.source } : {}),
      },
    };
  };

  return {
    register(entry: ErrorRegistryEntry): void {
      validateErrorCode(entry.code);
      validateLifecycle(entry.lifecycle ?? defaults?.lifecycle);
      entries.set(entry.code, { ...defaults, ...entry });
    },
    resolve(code: string): ErrorRegistryEntry | undefined {
      return entries.get(code);
    },
    toProblemDetails,
  };
}

export function toKitiumError(error: unknown, fallback?: ErrorShape): KitiumError {
  if (error instanceof KitiumError) {
    return error;
  }

  if (isObject(error) && 'code' in error && 'message' in error) {
    const shape = error as Record<string, unknown>;
    return new KitiumError(
      {
        code: String(shape['code']),
        message: String(shape['message']),
        statusCode: typeof shape['statusCode'] === 'number' ? shape['statusCode'] : undefined,
        severity: (shape['severity'] as ErrorSeverity) ?? 'error',
        kind: (shape['kind'] as ErrorKind) ?? 'internal',
        retryable: Boolean(shape['retryable']),
        retryDelay: typeof shape['retryDelay'] === 'number' ? shape['retryDelay'] : undefined,
        maxRetries: typeof shape['maxRetries'] === 'number' ? shape['maxRetries'] : undefined,
        backoff: ['linear', 'exponential', 'fixed'].includes(String(shape['backoff']))
          ? (shape['backoff'] as RetryBackoff)
          : undefined,
        help: typeof shape['help'] === 'string' ? shape['help'] : undefined,
        docs: typeof shape['docs'] === 'string' ? shape['docs'] : undefined,
        source: typeof shape['source'] === 'string' ? shape['source'] : undefined,
        lifecycle: ['draft', 'active', 'deprecated'].includes(String(shape['lifecycle']))
          ? (shape['lifecycle'] as ErrorShape['lifecycle'])
          : undefined,
        schemaVersion:
          typeof shape['schemaVersion'] === 'string' ? shape['schemaVersion'] : undefined,
        userMessage: typeof shape['userMessage'] === 'string' ? shape['userMessage'] : undefined,
        i18nKey: typeof shape['i18nKey'] === 'string' ? shape['i18nKey'] : undefined,
        redact: Array.isArray(shape['redact']) ? (shape['redact'] as string[]) : undefined,
        context: isObject(shape['context']) ? (shape['context'] as ErrorContext) : undefined,
        cause: shape['cause'],
      },
      false // Don't validate code for normalized errors
    );
  }

  if (fallback) {
    return new KitiumError(fallback);
  }

  return new KitiumError({
    code: 'unknown_error',
    message: error instanceof Error ? error.message : 'Unknown error',
    statusCode: 500,
    severity: 'error',
    kind: 'internal',
    retryable: false,
    cause: error,
  });
}

export function logError(error: KitiumError): void {
  const entry = httpErrorRegistry.resolve(error.code);
  const context = applyRedactions(error.context, error.redact ?? entry?.redact);
  const payload = {
    code: error.code,
    message: error.message,
    severity: error.severity,
    retryable: error.retryable,
    ...(error.statusCode !== undefined ? { statusCode: error.statusCode } : {}),
    ...(error.retryDelay !== undefined ? { retryDelay: error.retryDelay } : {}),
    ...(error.maxRetries !== undefined ? { maxRetries: error.maxRetries } : {}),
    ...(error.backoff !== undefined ? { backoff: error.backoff } : {}),
    ...(context !== undefined ? { context } : {}),
    ...(error.source !== undefined ? { source: error.source } : {}),
    ...(error.schemaVersion !== undefined ? { schemaVersion: error.schemaVersion } : {}),
    ...(error.lifecycle !== undefined ? { lifecycle: error.lifecycle } : {}),
    fingerprint: getErrorFingerprint(error),
  };

  switch (error.severity) {
    case 'fatal':
    case 'error':
      log?.error(error.message, payload);
      break;
    case 'warning':
      log?.warn(error.message, payload);
      break;
    case 'info':
      log?.info(error.message, payload);
      break;
    default:
      log?.debug(error.message, payload);
  }
}

const SPAN_STATUS_ERROR = 2;

export function recordException(error: KitiumError, span?: TraceSpanLike): void {
  if (!span) {
    return;
  }
  const fingerprint = getErrorFingerprint(error);
  span.setAttribute('kitium.error.code', error.code);
  span.setAttribute('kitium.error.kind', error.kind);
  span.setAttribute('kitium.error.severity', error.severity);
  span.setAttribute('kitium.error.retryable', error.retryable);
  span.setAttribute('kitium.error.fingerprint', fingerprint);
  if (error.lifecycle) {
    span.setAttribute('kitium.error.lifecycle', error.lifecycle);
  }
  if (error.schemaVersion) {
    span.setAttribute('kitium.error.schema_version', error.schemaVersion);
  }
  if (error.statusCode) {
    span.setAttribute('http.status_code', error.statusCode);
  }
  span.recordException({ ...error.toJSON(), name: error.name });
  span.setStatus({ code: SPAN_STATUS_ERROR, message: error.message });
}

export const httpErrorRegistry = createErrorRegistry({
  statusCode: 500,
  severity: 'error',
  kind: 'internal',
  retryable: false,
});

export function problemDetailsFrom(error: KitiumError): ProblemDetails {
  return httpErrorRegistry.toProblemDetails(error);
}

export function enrichError(error: KitiumError, context: Record<string, unknown>): KitiumError {
  const mergedContext = { ...(error.context ?? {}), ...context };
  return new KitiumError({ ...error.toJSON(), context: mergedContext }, false);
}

function computeDelay(baseDelay: number, backoff: RetryBackoff, attempt: number): number {
  if (backoff === 'fixed') {
    return baseDelay;
  }
  if (backoff === 'linear') {
    return baseDelay * attempt;
  }
  return baseDelay * 2 ** Math.max(0, attempt - 1);
}

export async function runWithRetry<T>(
  operation: () => Promise<T>,
  options?: RetryOptions
): Promise<RetryOutcome<T>> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 3);
  const baseDelay = options?.baseDelayMs ?? 200;
  const backoff = options?.backoff ?? 'exponential';

  let attempt = 0;
  let lastDelay: number | undefined;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      const result = await operation();
      return { attempts: attempt, result, lastDelayMs: lastDelay };
    } catch (err) {
      const kitiumError = toKitiumError(err);
      options?.onAttempt?.(attempt, kitiumError);
      if (!kitiumError.retryable || attempt >= maxAttempts) {
        return { attempts: attempt, error: kitiumError, lastDelayMs: lastDelay };
      }

      const delay = kitiumError.retryDelay ?? baseDelay;
      const backoffStrategy = kitiumError.backoff ?? backoff;
      lastDelay = computeDelay(delay, backoffStrategy, attempt);
      await new Promise((resolve) => setTimeout(resolve, lastDelay));
    }
  }

  return { attempts: attempt, lastDelayMs: lastDelay };
}

/**
 * Generates a fingerprint for error grouping in observability systems
 * @param error - Error to fingerprint
 * @returns Fingerprint string for error grouping
 */
export function getErrorFingerprint(error: KitiumError | ErrorShape): string {
  if (error instanceof KitiumError) {
    const shape = error.toJSON();
    // Use registry fingerprint if available
    const entry = httpErrorRegistry.resolve(shape.code);
    if (entry?.fingerprint) {
      return entry.fingerprint;
    }
    // Generate fingerprint from code and kind
    return `${shape.code}:${shape.kind}`;
  }
  return `${error.code}:${error.kind}`;
}

/**
 * Gets current error metrics
 * @returns Error metrics snapshot
 */
export function getErrorMetrics(): ErrorMetrics {
  return {
    totalErrors: errorMetrics.totalErrors,
    errorsByKind: { ...errorMetrics.errorsByKind },
    errorsBySeverity: { ...errorMetrics.errorsBySeverity },
    retryableErrors: errorMetrics.retryableErrors,
    nonRetryableErrors: errorMetrics.nonRetryableErrors,
  };
}

/**
 * Resets error metrics (useful for testing)
 */
export function resetErrorMetrics(): void {
  errorMetrics.totalErrors = 0;
  errorMetrics.errorsByKind = {
    business: 0,
    validation: 0,
    auth: 0,
    rate_limit: 0,
    not_found: 0,
    conflict: 0,
    dependency: 0,
    internal: 0,
  };
  errorMetrics.errorsBySeverity = {
    fatal: 0,
    error: 0,
    warning: 0,
    info: 0,
    debug: 0,
  };
  errorMetrics.retryableErrors = 0;
  errorMetrics.nonRetryableErrors = 0;
}

// Typed Error Subclasses
export class ValidationError extends KitiumError {
  constructor(shape: Omit<ErrorShape, 'kind'> & Partial<Pick<ErrorShape, 'kind'>>) {
    super(
      {
        ...shape,
        kind: shape.kind ?? 'validation',
        severity: shape.severity ?? 'warning',
        statusCode: shape.statusCode ?? 400,
      },
      true
    );
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends KitiumError {
  constructor(shape: Omit<ErrorShape, 'kind'> & Partial<Pick<ErrorShape, 'kind'>>) {
    super(
      {
        ...shape,
        kind: shape.kind ?? 'auth',
        severity: shape.severity ?? 'error',
        statusCode: shape.statusCode ?? 401,
      },
      true
    );
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends KitiumError {
  constructor(shape: Omit<ErrorShape, 'kind'> & Partial<Pick<ErrorShape, 'kind'>>) {
    super(
      {
        ...shape,
        kind: shape.kind ?? 'auth',
        severity: shape.severity ?? 'warning',
        statusCode: shape.statusCode ?? 403,
      },
      true
    );
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends KitiumError {
  constructor(shape: Omit<ErrorShape, 'kind'> & Partial<Pick<ErrorShape, 'kind'>>) {
    super(
      {
        ...shape,
        kind: shape.kind ?? 'not_found',
        severity: shape.severity ?? 'warning',
        statusCode: shape.statusCode ?? 404,
      },
      true
    );
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends KitiumError {
  constructor(shape: Omit<ErrorShape, 'kind'> & Partial<Pick<ErrorShape, 'kind'>>) {
    super(
      {
        ...shape,
        kind: shape.kind ?? 'conflict',
        severity: shape.severity ?? 'warning',
        statusCode: shape.statusCode ?? 409,
      },
      true
    );
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends KitiumError {
  constructor(shape: Omit<ErrorShape, 'kind'> & Partial<Pick<ErrorShape, 'kind'>>) {
    super(
      {
        ...shape,
        kind: shape.kind ?? 'rate_limit',
        severity: shape.severity ?? 'warning',
        statusCode: shape.statusCode ?? 429,
        retryable: shape.retryable ?? true,
        retryDelay: shape.retryDelay ?? 1000,
        backoff: shape.backoff ?? 'exponential',
      },
      true
    );
    this.name = 'RateLimitError';
  }
}

export class DependencyError extends KitiumError {
  constructor(shape: Omit<ErrorShape, 'kind'> & Partial<Pick<ErrorShape, 'kind'>>) {
    super(
      {
        ...shape,
        kind: shape.kind ?? 'dependency',
        severity: shape.severity ?? 'error',
        statusCode: shape.statusCode ?? 502,
        retryable: shape.retryable ?? true,
        retryDelay: shape.retryDelay ?? 500,
        backoff: shape.backoff ?? 'exponential',
        maxRetries: shape.maxRetries ?? 3,
      },
      true
    );
    this.name = 'DependencyError';
  }
}

export class BusinessError extends KitiumError {
  constructor(shape: Omit<ErrorShape, 'kind'> & Partial<Pick<ErrorShape, 'kind'>>) {
    super(
      {
        ...shape,
        kind: shape.kind ?? 'business',
        severity: shape.severity ?? 'error',
        statusCode: shape.statusCode ?? 400,
        retryable: shape.retryable ?? false,
      },
      true
    );
    this.name = 'BusinessError';
  }
}

export class InternalError extends KitiumError {
  constructor(shape: Omit<ErrorShape, 'kind'> & Partial<Pick<ErrorShape, 'kind'>>) {
    super(
      {
        ...shape,
        kind: shape.kind ?? 'internal',
        severity: shape.severity ?? 'error',
        statusCode: shape.statusCode ?? 500,
        retryable: shape.retryable ?? false,
      },
      true
    );
    this.name = 'InternalError';
  }
}

export * from './types';
