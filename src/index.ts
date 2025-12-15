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
  I18nMessage,
  ProblemDetails,
  RateLimitInfo,
  RetryBackoff,
  RetryOptions,
  RetryOutcome,
  TraceSpanLike,
} from './types';

const DEFAULT_DOCS_URL = 'https://kitiumai.com/docs/errors';
const CONTEXT_KEYS_TO_EXCLUDE = new Set(['correlationId', 'requestId'] as const);

function sanitizeContext(context: ErrorContext | undefined): {
  correlationId?: string;
  requestId?: string;
  context?: ErrorContext;
} {
  if (!context) {
    return {};
  }

  const correlationId =
    typeof context.correlationId === 'string' ? context.correlationId : undefined;
  const requestId = typeof context.requestId === 'string' ? context.requestId : undefined;

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (CONTEXT_KEYS_TO_EXCLUDE.has(key as 'correlationId' | 'requestId')) {
      continue;
    }
    // eslint-disable-next-line security/detect-object-injection
    sanitized[key] = value;
  }

  const result: { correlationId?: string; requestId?: string; context?: ErrorContext } = {};
  assignIfDefined(result as unknown as Record<string, unknown>, 'correlationId', correlationId);
  assignIfDefined(result as unknown as Record<string, unknown>, 'requestId', requestId);
  if (Object.keys(sanitized).length) {
    result.context = sanitized as ErrorContext;
  }
  return result;
}

function assignIfDefined(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined) {
    return;
  }
  // eslint-disable-next-line security/detect-object-injection
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
  return value ?? fallback;
}

type ErrorRegistryEntryLike = ErrorRegistryEntry | Partial<ErrorRegistryEntry> | undefined;

function entryField<K extends keyof ErrorRegistryEntry>(
  entry: ErrorRegistryEntryLike,
  field: K
): ErrorRegistryEntry[K] | undefined {
  if (!entry) {
    return undefined;
  }
  // eslint-disable-next-line security/detect-object-injection
  return (entry as ErrorRegistryEntry)[field];
}

function getToProblem(entry: ErrorRegistryEntryLike): ErrorRegistryEntry['toProblem'] | undefined {
  const toProblem = entryField(entry, 'toProblem');
  return typeof toProblem === 'function' ? toProblem : undefined;
}

function getInstance(error: ErrorShape): string | undefined {
  if (error instanceof KitiumError) {
    return firstDefined(error.correlationId, error.requestId);
  }

  return firstDefined(error.context?.correlationId, error.context?.requestId);
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

/**
 * Generates a unique request ID
 * @returns A unique request identifier
 */
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generates a unique correlation ID
 * @returns A unique correlation identifier
 */
export function generateCorrelationId(): string {
  return `corr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generates a unique idempotency key
 * @returns A unique idempotency key
 */
export function generateIdempotencyKey(): string {
  return `idemp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generates documentation URL for an error code
 * @param code - Error code
 * @returns Documentation URL
 */
export function generateDocumentationUrl(code: string): string {
  return `${DEFAULT_DOCS_URL}/${code}`;
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
  return isObject(value) ? structuredClone(value) : value;
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
    // eslint-disable-next-line security/detect-object-injection
    target[head] = redaction;
    return;
  }

  // eslint-disable-next-line security/detect-object-injection
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
// eslint-disable-next-line security/detect-unsafe-regex
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
    network: 0,
    timeout: 0,
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
  readonly i18nParams?: Record<string, unknown>;
  readonly redact?: string[];
  readonly context?: ErrorContext;
  readonly correlationId?: string;
  readonly requestId?: string;
  readonly rateLimit?: RateLimitInfo;
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
      ['i18nParams', shape.i18nParams],
      ['redact', shape.redact],
      ['rateLimit', shape.rateLimit],
      ['cause', shape.cause],
    ]);

    const sanitized = sanitizeContext(shape.context);
    if (sanitized.context !== undefined) {
      this.context = sanitized.context;
    }
    this.correlationId = sanitized.correlationId ?? generateCorrelationId();
    this.requestId = sanitized.requestId ?? generateRequestId();

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
      ['i18nParams', this.i18nParams],
      ['redact', this.redact],
      ['rateLimit', this.rateLimit],
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

// eslint-disable-next-line max-lines-per-function
export function createErrorRegistry(defaults?: Partial<ErrorRegistryEntry>): ErrorRegistry {
  const entries = new Map<string, ErrorRegistryEntry>();

  const toProblemDetails = (error: ErrorShape): ProblemDetails => {
    const entry = firstDefined(entries.get(error.code), defaults);
    const redactions = firstDefined(error.redact, entry?.redact);
    const context = applyRedactions(error.context, redactions);
    const typeUrl = firstDefinedOr(
      generateDocumentationUrl(error.code),
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

    const instance = getInstance(error);
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
      ['i18nParams', error.i18nParams],
      ['source', source],
      ['rateLimit', error.rateLimit],
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
    [
      'i18nParams',
      isObject(shape['i18nParams']) ? (shape['i18nParams'] as Record<string, unknown>) : undefined,
    ],
    ['redact', asStringArray(shape['redact'])],
    ['rateLimit', isObject(shape['rateLimit']) ? (shape['rateLimit'] as RateLimitInfo) : undefined],
    ['cause', 'cause' in shape ? shape['cause'] : undefined],
  ]);

  // Handle context with required fields
  const context = isObject(shape['context']) ? (shape['context'] as Record<string, unknown>) : {};
  const normalizedContext: ErrorContext = {
    correlationId: asString(context['correlationId']) ?? generateCorrelationId(),
    requestId: asString(context['requestId']) ?? generateRequestId(),
  };

  assignDefinedEntries(normalizedContext as unknown as Record<string, unknown>, [
    ['spanId', asString(context['spanId'])],
    ['tenantId', asString(context['tenantId'])],
    ['userId', asString(context['userId'])],
    ['idempotencyKey', asString(context['idempotencyKey'])],
    ['locale', asString(context['locale'])],
  ]);

  // Add any additional context fields
  for (const [key, value] of Object.entries(context)) {
    if (!(key in normalizedContext)) {
      // eslint-disable-next-line security/detect-object-injection
      (normalizedContext as unknown as Record<string, unknown>)[key] = value;
    }
  }

  assignIfDefined(normalized as unknown as Record<string, unknown>, 'context', normalizedContext);

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
    // Ensure fallback has required context fields
    const fallbackWithContext = {
      ...fallback,
      context: {
        correlationId: generateCorrelationId(),
        requestId: generateRequestId(),
        ...fallback.context,
      },
    };
    return new KitiumError(fallbackWithContext);
  }

  return new KitiumError({
    code: 'unknown_error',
    message: error instanceof Error ? error.message : 'Unknown error',
    statusCode: 500,
    severity: 'error',
    kind: 'internal',
    retryable: false,
    context: {
      correlationId: generateCorrelationId(),
      requestId: generateRequestId(),
    },
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
    ['i18nKey', error.i18nKey],
    ['i18nParams', error.i18nParams],
    ['rateLimit', error.rateLimit],
  ]);

  const redactions = error.redact ?? entry?.redact;
  const context = applyRedactions(error.context, redactions);
  if (context !== undefined) {
    payload['context'] = context;
  }

  // Extract the actual Error object from cause if available
  const errorObject = error.cause instanceof Error ? error.cause : error;

  const log = getLogger();
  const loggers = {
    fatal: () => log.error(error.message, payload, errorObject),
    error: () => log.error(error.message, payload, errorObject),
    warning: () => log.warn(error.message, payload),
    info: () => log.info(error.message, payload),
    debug: () => log.debug(error.message, payload),
  } as const;

  loggers[error.severity]();
}

const SPAN_STATUS_ERROR = 2;

export function recordException(error: KitiumError, span?: TraceSpanLike): void {
  if (!span) {
    return;
  }

  const fingerprint = getErrorFingerprint(error);

  // Set basic error attributes
  span.setAttribute('kitium.error.code', error.code);
  span.setAttribute('kitium.error.kind', error.kind);
  span.setAttribute('kitium.error.severity', error.severity);
  span.setAttribute('kitium.error.retryable', error.retryable);
  span.setAttribute('kitium.error.fingerprint', fingerprint);

  // Set optional attributes
  setOptionalSpanAttributes(span, error);

  // Record the exception
  span.recordException({ ...error.toJSON(), name: error.name });
  span.setStatus({ code: SPAN_STATUS_ERROR, message: error.message });
}

function setOptionalSpanAttributes(span: TraceSpanLike, error: KitiumError): void {
  setBasicErrorAttributes(span, error);
  setContextAttributes(span, error);
  setRateLimitAttributes(span, error);
}

function setBasicErrorAttributes(span: TraceSpanLike, error: KitiumError): void {
  if (error.lifecycle) {
    span.setAttribute('kitium.error.lifecycle', error.lifecycle);
  }
  if (error.schemaVersion) {
    span.setAttribute('kitium.error.schema_version', error.schemaVersion);
  }
  if (error.statusCode) {
    span.setAttribute('http.status_code', error.statusCode);
  }
}

function setContextAttributes(span: TraceSpanLike, error: KitiumError): void {
  if (error.requestId) {
    span.setAttribute('kitium.error.request_id', error.requestId);
  }
  if (error.correlationId) {
    span.setAttribute('kitium.error.correlation_id', error.correlationId);
  }
  if (error.context?.idempotencyKey) {
    span.setAttribute('kitium.error.idempotency_key', error.context.idempotencyKey);
  }
}

function setRateLimitAttributes(span: TraceSpanLike, error: KitiumError): void {
  if (error.rateLimit) {
    if (error.rateLimit.limit !== undefined) {
      span.setAttribute('kitium.error.rate_limit.limit', error.rateLimit.limit);
    }
    if (error.rateLimit.remaining !== undefined) {
      span.setAttribute('kitium.error.rate_limit.remaining', error.rateLimit.remaining);
    }
    if (error.rateLimit.resetTime !== undefined) {
      span.setAttribute('kitium.error.rate_limit.reset_time', error.rateLimit.resetTime);
    }
  }
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
  const extra = sanitizeContext(context as ErrorContext);
  const mergedContext = {
    ...(error.context ?? {}),
    ...(extra.context ?? {}),
  } as ErrorContext;

  const correlationId = firstDefined(extra.correlationId, error.correlationId);
  const requestId = firstDefined(extra.requestId, error.requestId);

  const rawContext = {
    ...(correlationId ? { correlationId } : {}),
    ...(requestId ? { requestId } : {}),
    ...mergedContext,
  } as ErrorContext;

  return new KitiumError({ ...error.toJSON(), context: rawContext }, false);
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
  const config = buildRetryConfig(options);
  const idempotencyKey = options?.idempotencyKey ?? generateIdempotencyKey();

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    const outcome = await tryOperation(operation);
    if (outcome.ok) {
      return buildSuccessOutcome(attempt, outcome.value, config.lastDelay);
    }

    const kitiumError = ensureErrorHasIdempotencyContext(outcome.error, idempotencyKey);
    callOnAttempt(options?.onAttempt, attempt, kitiumError);

    if (!shouldRetryAfter(kitiumError, attempt, config.maxAttempts)) {
      return buildErrorOutcome(attempt, kitiumError, config.lastDelay);
    }

    config.lastDelay = computeRetryDelayMs(
      kitiumError,
      config.baseDelay,
      config.defaultBackoff,
      attempt
    );
    await delayMs(config.lastDelay);
  }

  return buildRetryOutcome(config.maxAttempts, config.lastDelay);
}

function buildRetryConfig(options?: RetryOptions): {
  maxAttempts: number;
  baseDelay: number;
  defaultBackoff: RetryBackoff;
  lastDelay: number | undefined;
} {
  return {
    maxAttempts: Math.max(1, options?.maxAttempts ?? 3),
    baseDelay: options?.baseDelayMs ?? 200,
    defaultBackoff: options?.backoff ?? 'exponential',
    lastDelay: undefined as number | undefined,
  };
}

function ensureErrorHasIdempotencyContext(error: unknown, idempotencyKey: string): KitiumError {
  const kitiumError = toKitiumError(error);

  if (!kitiumError.context?.idempotencyKey) {
    return new KitiumError(
      {
        ...kitiumError.toJSON(),
        context: {
          ...kitiumError.context,
          correlationId: kitiumError.correlationId ?? generateCorrelationId(),
          requestId: kitiumError.requestId ?? generateRequestId(),
          idempotencyKey,
        },
      },
      false
    );
  }

  return kitiumError;
}

/**
 * Generates a fingerprint for error grouping in observability systems
 * @param error - Error to fingerprint
 * @returns Fingerprint string for error grouping
 */
export function getErrorFingerprint(error: KitiumError | ErrorShape): string {
  if (error instanceof KitiumError) {
    const entry = httpErrorRegistry.resolve(error.code);
    if (entry?.fingerprint) {
      return entry.fingerprint;
    }
    return `${error.code}:${error.kind}`;
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
    network: 0,
    timeout: 0,
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

export class NetworkError extends KitiumError {
  constructor(shape: Omit<ErrorShape, 'kind'> & Partial<Pick<ErrorShape, 'kind'>>) {
    super(
      {
        ...shape,
        kind: shape.kind ?? 'network',
        severity: shape.severity ?? 'error',
        statusCode: shape.statusCode ?? 502,
        retryable: shape.retryable ?? true,
        retryDelay: shape.retryDelay ?? 1000,
        backoff: shape.backoff ?? 'exponential',
        maxRetries: shape.maxRetries ?? 3,
      },
      true
    );
    this.name = 'NetworkError';
  }
}

export class TimeoutError extends KitiumError {
  constructor(shape: Omit<ErrorShape, 'kind'> & Partial<Pick<ErrorShape, 'kind'>>) {
    super(
      {
        ...shape,
        kind: shape.kind ?? 'timeout',
        severity: shape.severity ?? 'warning',
        statusCode: shape.statusCode ?? 504,
        retryable: shape.retryable ?? true,
        retryDelay: shape.retryDelay ?? 500,
        backoff: shape.backoff ?? 'linear',
        maxRetries: shape.maxRetries ?? 2,
      },
      true
    );
    this.name = 'TimeoutError';
  }
}

/**
 * Resolves an internationalized message for an error
 * @param error - Error to resolve message for
 * @param locale - Target locale (defaults to error context locale or 'en')
 * @returns Localized message or fallback
 */
export function resolveI18nMessage(error: KitiumError, locale?: string): string {
  const targetLocale = locale ?? error.context?.locale ?? 'en';

  // If no i18n key, return user message or default message
  if (!error.i18nKey) {
    return error.userMessage ?? error.message;
  }

  // TODO: Integrate with actual i18n system
  // For now, return a placeholder that shows the key and params
  const parameters = error.i18nParams ? JSON.stringify(error.i18nParams) : '';
  const parametersSuffix = parameters ? ` ${parameters}` : '';
  return `[${targetLocale}:${error.i18nKey}]${parametersSuffix}`;
}

export function createI18nMessage(
  key: string,
  parameters?: Record<string, unknown>,
  fallback?: string
): I18nMessage {
  const result: { key: string; params?: Record<string, unknown>; fallback?: string } = { key };
  if (parameters) {
    result.params = parameters;
  }
  if (fallback) {
    result.fallback = fallback;
  }
  return result as I18nMessage;
}

export function withI18n(
  error: KitiumError,
  i18nKey: string,
  parameters?: Record<string, unknown>,
  fallback?: string
): KitiumError {
  const shape = error.toJSON();
  const result: typeof shape & {
    i18nKey: string;
    userMessage: string;
    i18nParams?: Record<string, unknown>;
  } = {
    ...shape,
    i18nKey,
    userMessage: fallback ?? error.userMessage ?? error.message,
  };
  if (parameters) {
    result.i18nParams = parameters;
  }
  return new KitiumError(result, false);
}

export * from './types';
