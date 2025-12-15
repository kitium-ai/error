import { getLogger } from '@kitiumai/logger';

import type {
  ErrorContext,
  ErrorKind,
  ErrorLifecycle,
  ErrorMetrics,
  ErrorRegistry,
  ErrorRegistryEntry,
  ErrorSeverity,
  ErrorShape,
  ProblemDetails,
  RetryBackoff,
  RetryOptions,
  RetryOutcome,
  TraceSpanLike,
} from './types';

const DEFAULT_DOCS_URL = 'https://docs.kitium.ai/errors';
const log = getLogger();

function assignIfDefined(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined) {
    return;
  }
  target[key] = value;
}

function assignDefinedEntries(
  target: Record<string, unknown>,
  entries: ReadonlyArray<readonly [key: string, value: unknown]>
): void {
  for (const [key, value] of entries) {
    assignIfDefined(target, key, value);
  }
}

function firstDefined<T>(...values: ReadonlyArray<T | undefined>): T | undefined {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function firstDefinedOr<T>(fallback: T, ...values: ReadonlyArray<T | undefined>): T {
  const value = firstDefined(...values);
  return value === undefined ? fallback : value;
}

type ErrorRegistryEntryLike = ErrorRegistryEntry | Partial<ErrorRegistryEntry> | undefined;

function entryField<K extends keyof ErrorRegistryEntry>(
  entry: ErrorRegistryEntryLike,
  field: K
): ErrorRegistryEntry[K] | undefined {
  if (!entry) {
    return undefined;
  }
  return (entry as ErrorRegistryEntry)[field];
}

function getToProblem(entry: ErrorRegistryEntryLike): ErrorRegistryEntry['toProblem'] | undefined {
  const toProblem = entryField(entry, 'toProblem');
  return typeof toProblem === 'function' ? toProblem : undefined;
}

function getInstance(context: ErrorContext | undefined): string | undefined {
  if (!context) {
    return undefined;
  }
  return firstDefined(context.correlationId, context.requestId);
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? (value as string[]) : undefined;
}

function asRetryBackoff(value: unknown): RetryBackoff | undefined {
  const normalized = typeof value === 'string' ? value : '';
  return normalized === 'linear' || normalized === 'exponential' || normalized === 'fixed'
    ? normalized
    : undefined;
}

function asLifecycle(value: unknown): ErrorLifecycle | undefined {
  const normalized = typeof value === 'string' ? value : '';
  return normalized === 'draft' || normalized === 'active' || normalized === 'deprecated'
    ? normalized
    : undefined;
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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
  context: ErrorContext,
  redactPaths: string[] | undefined,
  redaction?: string
): ErrorContext;
function applyRedactions(
  context: ErrorContext | undefined,
  redactPaths: string[] | undefined,
  redaction?: string
): ErrorContext | undefined;
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
    ['rate_limit']: 0,
    ['not_found']: 0,
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

  constructor(shape: ErrorShape, validateCode = true) {
    super(shape.message);
    this.name = 'KitiumError';

    if (validateCode) {
      validateErrorCode(shape.code);
    }
    validateLifecycle(shape.lifecycle);

    this.code = shape.code;
    this.severity = shape.severity;
    this.kind = shape.kind;
    this.retryable = shape.retryable;

    assignDefinedEntries(this as unknown as Record<string, unknown>, [
      ['statusCode', shape.statusCode],
      ['lifecycle', shape.lifecycle],
      ['schemaVersion', shape.schemaVersion],
      ['retryDelay', shape.retryDelay],
      ['maxRetries', shape.maxRetries],
      ['backoff', shape.backoff],
      ['help', shape.help],
      ['docs', shape.docs],
      ['source', shape.source],
      ['userMessage', shape.userMessage],
      ['i18nKey', shape.i18nKey],
      ['redact', shape.redact],
      ['context', shape.context],
      ['cause', shape.cause],
    ]);

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
    const shape: ErrorShape = {
      code: this.code,
      message: this.message,
      severity: this.severity,
      kind: this.kind,
      retryable: this.retryable,
    };

    assignDefinedEntries(shape as unknown as Record<string, unknown>, [
      ['statusCode', this.statusCode],
      ['lifecycle', this.lifecycle],
      ['schemaVersion', this.schemaVersion],
      ['retryDelay', this.retryDelay],
      ['maxRetries', this.maxRetries],
      ['backoff', this.backoff],
      ['help', this.help],
      ['docs', this.docs],
      ['source', this.source],
      ['userMessage', this.userMessage],
      ['i18nKey', this.i18nKey],
      ['redact', this.redact],
      ['cause', this.cause],
    ]);
    assignIfDefined(
      shape as unknown as Record<string, unknown>,
      'context',
      this.context !== undefined ? applyRedactions(this.context, this.redact) : undefined
    );

    return shape;
  }
}

export function createErrorRegistry(defaults?: Partial<ErrorRegistryEntry>): ErrorRegistry {
  const entries = new Map<string, ErrorRegistryEntry>();

  const toProblemDetails = (error: ErrorShape): ProblemDetails => {
    const entry = firstDefined(entries.get(error.code), defaults);
    const redactions = firstDefined(error.redact, entry?.redact);
    const context = applyRedactions(error.context, redactions);
    const typeUrl = firstDefinedOr(
      `${DEFAULT_DOCS_URL}/${error.code}`,
      entryField(entry, 'docs'),
      error.docs
    );
    const status = firstDefined(error.statusCode, entryField(entry, 'statusCode'));
    const userMessage = firstDefined(error.userMessage, entryField(entry, 'userMessage'));
    const lifecycle = firstDefined(error.lifecycle, entryField(entry, 'lifecycle'));

    const toProblem = getToProblem(entry);
    if (toProblem) {
      return toProblem(error);
    }

    const problem: ProblemDetails = {
      type: typeUrl,
      title: userMessage ?? error.message,
    };

    const instance = getInstance(error.context);
    assignDefinedEntries(problem as unknown as Record<string, unknown>, [
      ['status', status],
      ['detail', error.help],
      ['instance', instance],
    ]);

    const extensions: Record<string, unknown> = {
      code: error.code,
      severity: error.severity,
      retryable: error.retryable,
      kind: error.kind,
    };

    const i18nKey = firstDefined(error.i18nKey, entryField(entry, 'i18nKey'));
    const source = firstDefined(error.source, entryField(entry, 'source'));

    assignDefinedEntries(extensions, [
      ['lifecycle', lifecycle],
      ['schemaVersion', error.schemaVersion],
      ['retryDelay', error.retryDelay],
      ['maxRetries', error.maxRetries],
      ['backoff', error.backoff],
      ['context', context],
      ['userMessage', userMessage],
      ['i18nKey', i18nKey],
      ['source', source],
    ]);

    assignIfDefined(problem as unknown as Record<string, unknown>, 'extensions', extensions);
    return problem;
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

function normalizeErrorShapeLike(shape: Record<string, unknown>): ErrorShape {
  const normalized: ErrorShape = {
    code: String(shape['code']),
    message: String(shape['message']),
    severity: (shape['severity'] as ErrorSeverity) ?? 'error',
    kind: (shape['kind'] as ErrorKind) ?? 'internal',
    retryable: Boolean(shape['retryable']),
  };

  assignDefinedEntries(normalized as unknown as Record<string, unknown>, [
    ['statusCode', asNumber(shape['statusCode'])],
    ['retryDelay', asNumber(shape['retryDelay'])],
    ['maxRetries', asNumber(shape['maxRetries'])],
    ['backoff', asRetryBackoff(shape['backoff'])],
    ['help', asString(shape['help'])],
    ['docs', asString(shape['docs'])],
    ['source', asString(shape['source'])],
    ['lifecycle', asLifecycle(shape['lifecycle'])],
    ['schemaVersion', asString(shape['schemaVersion'])],
    ['userMessage', asString(shape['userMessage'])],
    ['i18nKey', asString(shape['i18nKey'])],
    ['redact', asStringArray(shape['redact'])],
    ['context', isObject(shape['context']) ? (shape['context'] as ErrorContext) : undefined],
    ['cause', 'cause' in shape ? shape['cause'] : undefined],
  ]);

  return normalized;
}

export function toKitiumError(error: unknown, fallback?: ErrorShape): KitiumError {
  if (error instanceof KitiumError) {
    return error;
  }

  if (isObject(error) && 'code' in error && 'message' in error) {
    return new KitiumError(normalizeErrorShapeLike(error), false);
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
  const payload: Record<string, unknown> = {
    code: error.code,
    message: error.message,
    severity: error.severity,
    retryable: error.retryable,
    fingerprint: getErrorFingerprint(error),
  };

  assignDefinedEntries(payload, [
    ['statusCode', error.statusCode],
    ['retryDelay', error.retryDelay],
    ['maxRetries', error.maxRetries],
    ['backoff', error.backoff],
    ['source', error.source],
    ['schemaVersion', error.schemaVersion],
    ['lifecycle', error.lifecycle],
  ]);

  let redactions = error.redact;
  if (redactions === undefined) {
    redactions = entry?.redact;
  }
  const context = applyRedactions(error.context, redactions);
  if (context !== undefined) {
    payload['context'] = context;
  }

  const loggers = {
    fatal: () => log?.error(error.message, payload),
    error: () => log?.error(error.message, payload),
    warning: () => log?.warn(error.message, payload),
    info: () => log?.info(error.message, payload),
    debug: () => log?.debug(error.message, payload),
  } as const;

  loggers[error.severity]();
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

type OperationAttemptResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

async function tryOperation<T>(operation: () => Promise<T>): Promise<OperationAttemptResult<T>> {
  try {
    const value = await operation();
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error };
  }
}

function callOnAttempt(
  onAttempt: RetryOptions['onAttempt'] | undefined,
  attempt: number,
  error: KitiumError
): void {
  if (!onAttempt) {
    return;
  }
  onAttempt(attempt, error);
}

function shouldRetryAfter(error: KitiumError, attempt: number, maxAttempts: number): boolean {
  if (!error.retryable) {
    return false;
  }
  return attempt < maxAttempts;
}

function computeRetryDelayMs(
  error: KitiumError,
  baseDelay: number,
  defaultBackoff: RetryBackoff,
  attempt: number
): number {
  let delay = baseDelay;
  if (error.retryDelay !== undefined) {
    delay = error.retryDelay;
  }

  let backoff = defaultBackoff;
  if (error.backoff !== undefined) {
    backoff = error.backoff;
  }

  return computeDelay(delay, backoff, attempt);
}

function buildRetryOutcome<T>(attempts: number, lastDelayMs: number | undefined): RetryOutcome<T> {
  const outcome: RetryOutcome<T> = { attempts };
  if (lastDelayMs !== undefined) {
    (outcome as unknown as Record<string, unknown>)['lastDelayMs'] = lastDelayMs;
  }
  return outcome;
}

function buildSuccessOutcome<T>(
  attempts: number,
  result: T,
  lastDelayMs: number | undefined
): RetryOutcome<T> {
  const outcome = buildRetryOutcome<T>(attempts, lastDelayMs);
  (outcome as unknown as Record<string, unknown>)['result'] = result;
  return outcome;
}

function buildErrorOutcome<T>(
  attempts: number,
  error: unknown,
  lastDelayMs: number | undefined
): RetryOutcome<T> {
  const outcome = buildRetryOutcome<T>(attempts, lastDelayMs);
  (outcome as unknown as Record<string, unknown>)['error'] = error;
  return outcome;
}

export async function runWithRetry<T>(
  operation: () => Promise<T>,
  options?: RetryOptions
): Promise<RetryOutcome<T>> {
  let maxAttempts = 3;
  if (options?.maxAttempts !== undefined) {
    maxAttempts = options.maxAttempts;
  }
  maxAttempts = Math.max(1, maxAttempts);

  let baseDelay = 200;
  if (options?.baseDelayMs !== undefined) {
    baseDelay = options.baseDelayMs;
  }

  let defaultBackoff: RetryBackoff = 'exponential';
  if (options?.backoff !== undefined) {
    defaultBackoff = options.backoff;
  }
  let lastDelay: number | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const outcome = await tryOperation(operation);
    if (outcome.ok) {
      return buildSuccessOutcome(attempt, outcome.value, lastDelay);
    }

    const kitiumError = toKitiumError(outcome.error);
    callOnAttempt(options?.onAttempt, attempt, kitiumError);
    if (!shouldRetryAfter(kitiumError, attempt, maxAttempts)) {
      return buildErrorOutcome(attempt, kitiumError, lastDelay);
    }

    lastDelay = computeRetryDelayMs(kitiumError, baseDelay, defaultBackoff, attempt);
    await delayMs(lastDelay);
  }

  return buildRetryOutcome(maxAttempts, lastDelay);
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
    ['rate_limit']: 0,
    ['not_found']: 0,
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
