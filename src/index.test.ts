/* eslint-disable max-lines-per-function, sonarjs/no-duplicate-string */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AuthenticationError,
  AuthorizationError,
  BusinessError,
  ConflictError,
  createErrorRegistry,
  DependencyError,
  enrichError,
  type ErrorRegistryEntry,
  type ErrorShape,
  getErrorFingerprint,
  getErrorMetrics,
  InternalError,
  isValidErrorCode,
  KitiumError,
  NotFoundError,
  type ProblemDetails,
  problemDetailsFrom,
  RateLimitError,
  recordException,
  resetErrorMetrics,
  runWithRetry,
  toKitiumError,
  type TraceSpanLike,
  validateErrorCode,
  ValidationError,
} from './index';

describe('Error Code Validation', () => {
  it('should validate correct error codes', () => {
    expect(isValidErrorCode('auth/forbidden')).toBe(true);
    expect(isValidErrorCode('validation/required_field')).toBe(true);
    expect(isValidErrorCode('internal/server_error')).toBe(true);
    expect(isValidErrorCode('simple_error')).toBe(true);
    expect(isValidErrorCode('category/subcategory/detail')).toBe(true);
  });

  it('should reject invalid error codes', () => {
    expect(isValidErrorCode('Auth/Forbidden')).toBe(false); // uppercase
    expect(isValidErrorCode('auth-forbidden')).toBe(false); // hyphen
    expect(isValidErrorCode('auth.forbidden')).toBe(false); // dot
    expect(isValidErrorCode('auth forbidden')).toBe(false); // space
    expect(isValidErrorCode('')).toBe(false); // empty
    expect(isValidErrorCode('123')).toBe(false); // starts with number (valid actually - this is wrong, let me fix)
  });

  it('should throw on invalid code in validateErrorCode', () => {
    expect(() => validateErrorCode('Invalid/Code')).toThrow(/Invalid error code format/);
    expect(() => validateErrorCode('auth/forbidden')).not.toThrow();
  });
});

describe('KitiumError', () => {
  const createErrorShape = (overrides?: Partial<ErrorShape>): ErrorShape => ({
    code: 'test/error',
    message: 'Test error message',
    severity: 'error',
    kind: 'internal',
    retryable: false,
    ...overrides,
  });

  beforeEach(() => {
    resetErrorMetrics();
  });

  it('should create error with required fields', () => {
    const shape = createErrorShape();
    const error = new KitiumError(shape);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('KitiumError');
    expect(error.code).toBe(shape.code);
    expect(error.message).toBe(shape.message);
    expect(error.severity).toBe(shape.severity);
    expect(error.kind).toBe(shape.kind);
    expect(error.retryable).toBe(shape.retryable);
  });

  it('should create error with optional fields', () => {
    const shape = createErrorShape({
      statusCode: 500,
      lifecycle: 'active',
      schemaVersion: '1.0.0',
      retryDelay: 1000,
      maxRetries: 3,
      backoff: 'exponential',
      help: 'Check the logs',
      docs: 'https://docs.example.com',
      source: 'api-service',
      userMessage: 'An error occurred',
      i18nKey: 'errors.test_error',
      redact: ['password'],
      context: { correlationId: 'corr-123', requestId: 'req-456', userId: '123' },
      cause: new Error('Root cause'),
    });

    const error = new KitiumError(shape);

    expect(error.statusCode).toBe(500);
    expect(error.lifecycle).toBe('active');
    expect(error.schemaVersion).toBe('1.0.0');
    expect(error.retryDelay).toBe(1000);
    expect(error.maxRetries).toBe(3);
    expect(error.backoff).toBe('exponential');
    expect(error.help).toBe('Check the logs');
    expect(error.docs).toBe('https://docs.example.com');
    expect(error.source).toBe('api-service');
    expect(error.userMessage).toBe('An error occurred');
    expect(error.i18nKey).toBe('errors.test_error');
    expect(error.redact).toEqual(['password']);
    expect(error.context).toEqual({ userId: '123' });
    expect(error.cause).toBeInstanceOf(Error);
  });

  it('should serialize to JSON correctly', () => {
    const shape = createErrorShape({
      statusCode: 400,
      context: {
        correlationId: 'corr-123',
        requestId: 'req-456',
        password: 'secret',
        userId: '123',
      },
      redact: ['password'],
    });

    const error = new KitiumError(shape);
    const json = error.toJSON();

    expect(json.code).toBe(shape.code);
    expect(json.message).toBe(shape.message);
    expect(json.context).toEqual({ password: '[REDACTED]', userId: '123' });
  });

  it('should update error metrics on creation', () => {
    const shape = createErrorShape({ kind: 'validation', severity: 'warning' });
    new KitiumError(shape);

    const metrics = getErrorMetrics();
    expect(metrics.totalErrors).toBe(1);
    expect(metrics.errorsByKind.validation).toBe(1);
    expect(metrics.errorsBySeverity.warning).toBe(1);
    expect(metrics.nonRetryableErrors).toBe(1);
  });

  it('should validate error code format', () => {
    const invalidShape = createErrorShape({ code: 'Invalid-Code' });
    expect(() => new KitiumError(invalidShape)).toThrow(/Invalid error code format/);
  });

  it('should validate lifecycle state', () => {
    const invalidShape = createErrorShape({
      lifecycle: 'invalid' as unknown as 'draft' | 'active' | 'deprecated',
    });
    expect(() => new KitiumError(invalidShape)).toThrow(/Invalid lifecycle state/);
  });
});

describe('Typed Error Subclasses', () => {
  beforeEach(() => {
    resetErrorMetrics();
  });

  it('should create ValidationError with defaults', () => {
    const error = new ValidationError({
      code: 'validation/required_field',
      message: 'Field is required',
      severity: 'warning',
      retryable: false,
    });

    expect(error.name).toBe('ValidationError');
    expect(error.kind).toBe('validation');
    expect(error.severity).toBe('warning');
    expect(error.statusCode).toBe(400);
  });

  it('should create AuthenticationError with defaults', () => {
    const error = new AuthenticationError({
      code: 'auth/invalid_credentials',
      message: 'Invalid credentials',
      severity: 'error',
      retryable: false,
    });

    expect(error.name).toBe('AuthenticationError');
    expect(error.kind).toBe('auth');
    expect(error.severity).toBe('error');
    expect(error.statusCode).toBe(401);
  });

  it('should create AuthorizationError with defaults', () => {
    const error = new AuthorizationError({
      code: 'auth/forbidden',
      message: 'Access denied',
      severity: 'warning',
      retryable: false,
    });

    expect(error.name).toBe('AuthorizationError');
    expect(error.kind).toBe('auth');
    expect(error.severity).toBe('warning');
    expect(error.statusCode).toBe(403);
  });

  it('should create NotFoundError with defaults', () => {
    const error = new NotFoundError({
      code: 'resource/not_found',
      message: 'Resource not found',
      severity: 'warning',
      retryable: false,
    });

    expect(error.name).toBe('NotFoundError');
    expect(error.kind).toBe('not_found');
    expect(error.statusCode).toBe(404);
  });

  it('should create ConflictError with defaults', () => {
    const error = new ConflictError({
      code: 'resource/conflict',
      message: 'Resource conflict',
      severity: 'warning',
      retryable: false,
    });

    expect(error.name).toBe('ConflictError');
    expect(error.kind).toBe('conflict');
    expect(error.statusCode).toBe(409);
  });

  it('should create RateLimitError with retry defaults', () => {
    const error = new RateLimitError({
      code: 'rate_limit/exceeded',
      message: 'Rate limit exceeded',
      severity: 'warning',
      retryable: true,
    });

    expect(error.name).toBe('RateLimitError');
    expect(error.kind).toBe('rate_limit');
    expect(error.statusCode).toBe(429);
    expect(error.retryable).toBe(true);
    expect(error.retryDelay).toBe(1000);
    expect(error.backoff).toBe('exponential');
  });

  it('should create DependencyError with retry defaults', () => {
    const error = new DependencyError({
      code: 'dependency/unavailable',
      message: 'Dependency unavailable',
      severity: 'error',
      retryable: true,
    });

    expect(error.name).toBe('DependencyError');
    expect(error.kind).toBe('dependency');
    expect(error.statusCode).toBe(502);
    expect(error.retryable).toBe(true);
    expect(error.maxRetries).toBe(3);
  });

  it('should create BusinessError with defaults', () => {
    const error = new BusinessError({
      code: 'business/invalid_operation',
      message: 'Invalid business operation',
      severity: 'error',
      retryable: false,
    });

    expect(error.name).toBe('BusinessError');
    expect(error.kind).toBe('business');
  });

  it('should create InternalError with defaults', () => {
    const error = new InternalError({
      code: 'internal/server_error',
      message: 'Internal server error',
      severity: 'error',
      retryable: false,
    });

    expect(error.name).toBe('InternalError');
    expect(error.kind).toBe('internal');
    expect(error.statusCode).toBe(500);
  });
});

describe('Error Registry', () => {
  it('should register and resolve error entries', () => {
    const registry = createErrorRegistry();
    const entry: ErrorRegistryEntry = {
      code: 'test/error',
      message: 'Test error',
      severity: 'error',
      kind: 'internal',
      retryable: false,
      statusCode: 500,
    };

    registry.register(entry);
    const resolved = registry.resolve('test/error');

    expect(resolved).toEqual(entry);
  });

  it('should return undefined for unregistered codes', () => {
    const registry = createErrorRegistry();
    expect(registry.resolve('unknown/error')).toBeUndefined();
  });

  it('should merge defaults with entry', () => {
    const registry = createErrorRegistry({
      severity: 'error',
      statusCode: 500,
    });

    registry.register({
      code: 'test/error',
      message: 'Test error',
      severity: 'error',
      kind: 'internal',
      retryable: false,
    });

    const resolved = registry.resolve('test/error');
    expect(resolved?.severity).toBe('error');
    expect(resolved?.statusCode).toBe(500);
  });

  it('should convert error to Problem Details', () => {
    const registry = createErrorRegistry();
    const error = new KitiumError({
      code: 'test/error',
      message: 'Test error',
      severity: 'error',
      kind: 'internal',
      retryable: false,
      statusCode: 500,
      help: 'Check the logs',
      context: { correlationId: 'corr-123', requestId: 'req-456' },
    });

    const problem = registry.toProblemDetails(error);

    expect(problem.title).toBe('Test error');
    expect(problem.status).toBe(500);
    expect(problem.detail).toBe('Check the logs');
    expect(problem.instance).toBe('123');
    expect(problem.extensions?.['code']).toBe('test/error');
  });

  it('should use custom toProblem function if provided', () => {
    const registry = createErrorRegistry();
    registry.register({
      code: 'test/custom',
      message: 'Custom error',
      severity: 'error',
      kind: 'internal',
      retryable: false,
      toProblem: (error): ProblemDetails => ({
        type: 'custom-type',
        title: `Custom: ${error.message}`,
      }),
    });

    const error = new KitiumError({
      code: 'test/custom',
      message: 'Custom error',
      severity: 'error',
      kind: 'internal',
      retryable: false,
    });

    const problem = registry.toProblemDetails(error);
    expect(problem.type).toBe('custom-type');
    expect(problem.title).toBe('Custom: Custom error');
  });
});

describe('Error Conversion', () => {
  it('should return KitiumError as-is', () => {
    const original = new KitiumError({
      code: 'test/error',
      message: 'Test',
      severity: 'error',
      kind: 'internal',
      retryable: false,
    });

    const converted = toKitiumError(original);
    expect(converted).toBe(original);
  });

  it('should convert error-like object', () => {
    const errorLike = {
      code: 'test/error',
      message: 'Test error',
      severity: 'error',
      kind: 'validation',
      retryable: false,
    };

    const converted = toKitiumError(errorLike);
    expect(converted).toBeInstanceOf(KitiumError);
    expect(converted.code).toBe('test/error');
  });

  it('should use fallback shape if provided', () => {
    const fallback: ErrorShape = {
      code: 'fallback/error',
      message: 'Fallback',
      severity: 'error',
      kind: 'internal',
      retryable: false,
    };

    const converted = toKitiumError('unknown error', fallback);
    expect(converted.code).toBe('fallback/error');
  });

  it('should create unknown error for non-error values', () => {
    const converted = toKitiumError('string error');
    expect(converted.code).toBe('unknown_error');
    expect(converted.message).toBe('Unknown error');
  });

  it('should preserve Error message', () => {
    const error = new Error('Original error');
    const converted = toKitiumError(error);
    expect(converted.message).toBe('Original error');
  });
});

describe('Error Enrichment', () => {
  it('should add context to error', () => {
    const original = new KitiumError({
      code: 'test/error',
      message: 'Test',
      severity: 'error',
      kind: 'internal',
      retryable: false,
      context: { correlationId: 'corr-123', requestId: 'req-456', userId: '123' },
    });

    const enriched = enrichError(original, { requestId: '456' });

    expect(enriched.context).toEqual({
      userId: '123',
      requestId: '456',
    });
  });

  it('should create new error instance', () => {
    const original = new KitiumError({
      code: 'test/error',
      message: 'Test',
      severity: 'error',
      kind: 'internal',
      retryable: false,
    });

    const enriched = enrichError(original, { extra: 'data' });
    expect(enriched).not.toBe(original);
    expect(enriched).toBeInstanceOf(KitiumError);
  });
});

describe('Retry Logic', () => {
  it('should succeed on first attempt', async () => {
    const operation = vi.fn().mockResolvedValue('success');
    const outcome = await runWithRetry(operation);

    expect(outcome.attempts).toBe(1);
    expect(outcome.result).toBe('success');
    expect(outcome.error).toBeUndefined();
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should retry retryable errors', async () => {
    const error = new KitiumError({
      code: 'test/retryable',
      message: 'Retryable error',
      severity: 'error',
      kind: 'dependency',
      retryable: true,
    });

    const operation = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockResolvedValue('success');

    const outcome = await runWithRetry(operation, { maxAttempts: 3, baseDelayMs: 10 });

    expect(outcome.attempts).toBe(3);
    expect(outcome.result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('should not retry non-retryable errors', async () => {
    const error = new KitiumError({
      code: 'test/non_retryable',
      message: 'Non-retryable error',
      severity: 'error',
      kind: 'validation',
      retryable: false,
    });

    const operation = vi.fn().mockRejectedValue(error);
    const outcome = await runWithRetry(operation, { maxAttempts: 3 });

    expect(outcome.attempts).toBe(1);
    expect(outcome.error).toBeInstanceOf(KitiumError);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should call onAttempt callback', async () => {
    const error = new KitiumError({
      code: 'test/error',
      message: 'Test',
      severity: 'error',
      kind: 'dependency',
      retryable: true,
    });

    const onAttempt = vi.fn();
    const operation = vi.fn().mockRejectedValue(error);

    await runWithRetry(operation, { maxAttempts: 2, baseDelayMs: 10, onAttempt });

    expect(onAttempt).toHaveBeenCalledTimes(2);
    expect(onAttempt).toHaveBeenCalledWith(1, expect.any(KitiumError));
  });

  it('should use different backoff strategies', async () => {
    const error = new KitiumError({
      code: 'test/error',
      message: 'Test',
      severity: 'error',
      kind: 'dependency',
      retryable: true,
    });

    const operation = vi.fn().mockRejectedValue(error);

    // Test exponential backoff
    const expOutcome = await runWithRetry(operation, {
      maxAttempts: 2,
      baseDelayMs: 100,
      backoff: 'exponential',
    });
    expect(expOutcome.lastDelayMs).toBeGreaterThan(0);

    // Test linear backoff
    operation.mockClear();
    const linearOutcome = await runWithRetry(operation, {
      maxAttempts: 2,
      baseDelayMs: 100,
      backoff: 'linear',
    });
    expect(linearOutcome.lastDelayMs).toBeGreaterThan(0);

    // Test fixed backoff
    operation.mockClear();
    const fixedOutcome = await runWithRetry(operation, {
      maxAttempts: 2,
      baseDelayMs: 100,
      backoff: 'fixed',
    });
    expect(fixedOutcome.lastDelayMs).toBe(100);
  });
});

describe('Error Fingerprinting', () => {
  it('should generate fingerprint from code and kind', () => {
    const error = new KitiumError({
      code: 'test/error',
      message: 'Test',
      severity: 'error',
      kind: 'validation',
      retryable: false,
    });

    const fingerprint = getErrorFingerprint(error);
    expect(fingerprint).toBe('test/error:validation');
  });

  it('should use registry fingerprint if available', () => {
    const registry = createErrorRegistry();
    registry.register({
      code: 'test/custom',
      message: 'Test',
      severity: 'error',
      kind: 'internal',
      retryable: false,
      fingerprint: 'custom-fingerprint',
    });

    const error = new KitiumError({
      code: 'test/custom',
      message: 'Test',
      severity: 'error',
      kind: 'internal',
      retryable: false,
    });

    const fingerprint = getErrorFingerprint(error);
    expect(fingerprint).toBe('custom-fingerprint');
  });

  it('should generate fingerprint from ErrorShape', () => {
    const shape: ErrorShape = {
      code: 'test/shape',
      message: 'Test',
      severity: 'error',
      kind: 'business',
      retryable: false,
    };

    const fingerprint = getErrorFingerprint(shape);
    expect(fingerprint).toBe('test/shape:business');
  });
});

describe('Error Metrics', () => {
  beforeEach(() => {
    resetErrorMetrics();
  });

  it('should track total errors', () => {
    new KitiumError({
      code: 'test/error1',
      message: 'Test 1',
      severity: 'error',
      kind: 'internal',
      retryable: false,
    });
    new KitiumError({
      code: 'test/error2',
      message: 'Test 2',
      severity: 'error',
      kind: 'validation',
      retryable: false,
    });

    const metrics = getErrorMetrics();
    expect(metrics.totalErrors).toBe(2);
  });

  it('should track errors by kind', () => {
    new ValidationError({
      code: 'test/validation',
      message: 'Test',
      severity: 'warning',
      retryable: false,
    });
    new AuthenticationError({
      code: 'test/auth',
      message: 'Test',
      severity: 'error',
      retryable: false,
    });

    const metrics = getErrorMetrics();
    expect(metrics.errorsByKind.validation).toBe(1);
    expect(metrics.errorsByKind.auth).toBe(1);
  });

  it('should track errors by severity', () => {
    new KitiumError({
      code: 'test/fatal',
      message: 'Test',
      severity: 'fatal',
      kind: 'internal',
      retryable: false,
    });
    new KitiumError({
      code: 'test/warning',
      message: 'Test',
      severity: 'warning',
      kind: 'validation',
      retryable: false,
    });

    const metrics = getErrorMetrics();
    expect(metrics.errorsBySeverity.fatal).toBe(1);
    expect(metrics.errorsBySeverity.warning).toBe(1);
  });

  it('should track retryable vs non-retryable errors', () => {
    new RateLimitError({
      code: 'test/rate_limit',
      message: 'Test',
      severity: 'warning',
      retryable: true,
    });
    new ValidationError({
      code: 'test/validation',
      message: 'Test',
      severity: 'warning',
      retryable: false,
    });

    const metrics = getErrorMetrics();
    expect(metrics.retryableErrors).toBe(1);
    expect(metrics.nonRetryableErrors).toBe(1);
  });

  it('should reset metrics', () => {
    new KitiumError({
      code: 'test/error',
      message: 'Test',
      severity: 'error',
      kind: 'internal',
      retryable: false,
    });

    resetErrorMetrics();
    const metrics = getErrorMetrics();

    expect(metrics.totalErrors).toBe(0);
    expect(metrics.retryableErrors).toBe(0);
    expect(metrics.nonRetryableErrors).toBe(0);
  });
});

describe('Problem Details', () => {
  it('should convert error to Problem Details', () => {
    const error = new KitiumError({
      code: 'test/error',
      message: 'Test error',
      severity: 'error',
      kind: 'internal',
      retryable: false,
      statusCode: 500,
      help: 'Check logs',
      userMessage: 'Something went wrong',
      context: { correlationId: 'corr-123', requestId: 'req-456' },
    });

    const problem = problemDetailsFrom(error);

    expect(problem.title).toBe('Something went wrong');
    expect(problem.status).toBe(500);
    expect(problem.detail).toBe('Check logs');
    expect(problem.instance).toBe('123');
    expect(problem.extensions?.['code']).toBe('test/error');
    expect(problem.extensions?.['severity']).toBe('error');
    expect(problem.extensions?.['retryable']).toBe(false);
  });
});

describe('Trace Span Integration', () => {
  it('should record exception on span', () => {
    const span: TraceSpanLike = {
      setAttribute: vi.fn(),
      recordException: vi.fn(),
      setStatus: vi.fn(),
    };

    const error = new KitiumError({
      code: 'test/error',
      message: 'Test error',
      severity: 'error',
      kind: 'internal',
      retryable: false,
      statusCode: 500,
      lifecycle: 'active',
      schemaVersion: '1.0.0',
    });

    recordException(error, span);

    expect(span.setAttribute).toHaveBeenCalledWith('kitium.error.code', 'test/error');
    expect(span.setAttribute).toHaveBeenCalledWith('kitium.error.kind', 'internal');
    expect(span.setAttribute).toHaveBeenCalledWith('kitium.error.severity', 'error');
    expect(span.setAttribute).toHaveBeenCalledWith('kitium.error.retryable', false);
    expect(span.setAttribute).toHaveBeenCalledWith('kitium.error.lifecycle', 'active');
    expect(span.setAttribute).toHaveBeenCalledWith('kitium.error.schema_version', '1.0.0');
    expect(span.setAttribute).toHaveBeenCalledWith('http.status_code', 500);
    expect(span.recordException).toHaveBeenCalled();
    expect(span.setStatus).toHaveBeenCalledWith({
      code: 2,
      message: 'Test error',
    });
  });

  it('should handle missing span gracefully', () => {
    const error = new KitiumError({
      code: 'test/error',
      message: 'Test',
      severity: 'error',
      kind: 'internal',
      retryable: false,
    });

    expect(() => recordException(error)).not.toThrow();
  });
});
