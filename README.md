# @kitiumai/error

Enterprise-grade error primitives for Kitium products. This library provides a single source of truth for error taxonomy, structured logging, HTTP/Problem Details mapping, and registry-driven governance – the kind of capabilities expected in large-scale products.

## Usage & Tree-Shaking

This package is ESM-first and `sideEffects: false`. Import only what you need using subpath exports to keep bundles lean.

- Core runtime:
  - `import { KitiumError, ValidationError, problemDetailsFrom } from '@kitiumai/error'`

- Types-only:
  - `import type { ErrorShape, ProblemDetails } from '@kitiumai/error/types'`

Use `@kitiumai/error/types` when you only need type imports to avoid pulling runtime code.

## Features

- ✅ **Typed Error Classes**: `KitiumError` with rich metadata and typed subclasses for common error types
- ✅ **Retry Strategy Metadata**: Detailed retry information (delay, max retries, backoff strategy)
- ✅ **Error Code Validation**: Automatic validation of error code format
- ✅ **Error Registry**: Centralized error code management with defaults
- ✅ **RFC 7807 Problem Details**: Full compliance with HTTP Problem Details standard
- ✅ **Error Fingerprinting**: Automatic error grouping for observability systems
- ✅ **Error Metrics**: Built-in error metrics tracking and export
- ✅ **Structured Logging**: Severity-aware logging with `@kitiumai/logger`
- ✅ **Context Enrichment**: Safe context merging for distributed tracing
- ✅ **Error Normalization**: Convert unknown errors to consistent shape
- ✅ **Lifecycle + Redaction**: Registry-driven lifecycle states, schema versions, and PII redaction controls
- ✅ **Safe Messaging**: Separate internal `message` from localized `userMessage`/`i18nKey`
- ✅ **Retry Execution Helper**: `runWithRetry` executes retry policies consistently
- ✅ **Tracing Helper**: `recordException` propagates error metadata into spans

## Installation

```bash
npm install @kitiumai/error
# or
pnpm add @kitiumai/error
# or
yarn add @kitiumai/error
```

## Quick start

### Basic Usage

```ts
import {
  KitiumError,
  httpErrorRegistry,
  logError,
  problemDetailsFrom,
  toKitiumError,
} from '@kitiumai/error';

// Register error definitions in your application startup
httpErrorRegistry.register({
  code: 'auth/forbidden',
  message: 'Access denied',
  statusCode: 403,
  severity: 'warning',
  kind: 'auth',
  retryable: false,
  lifecycle: 'active',
  schemaVersion: '2024-12-01',
  userMessage: 'You do not have permission to perform this action',
  redact: ['context.userId'],
  docs: 'https://docs.kitium.ai/errors/auth/forbidden',
});

// Create and use errors
const err = new KitiumError({
  code: 'auth/forbidden',
  message: 'You cannot access this resource',
  statusCode: 403,
  severity: 'warning',
  kind: 'auth',
  retryable: false,
  context: { correlationId: 'corr-123', userId: 'user-456' },
});

// Log the error
logError(err);

// Convert to Problem Details for HTTP responses
const problem = problemDetailsFrom(err);
// {
//   type: 'https://docs.kitium.ai/errors/auth/forbidden',
//   title: 'You do not have permission to perform this action',
//   status: 403,
//   instance: 'corr-123',
//   extensions: {
//     code: 'auth/forbidden',
//     severity: 'warning',
//     retryable: false,
//     kind: 'auth',
//     context: { correlationId: 'corr-123', userId: '[REDACTED]' }
//   }
// }
```

### Express.js Integration Example

```ts
import express from 'express';
import {
  KitiumError,
  problemDetailsFrom,
  toKitiumError,
  enrichError,
  logError,
} from '@kitiumai/error';

const app = express();

// Error handling middleware
app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Normalize unknown errors
  const kitiumError = toKitiumError(err, {
    code: 'internal/server_error',
    message: 'An unexpected error occurred',
    statusCode: 500,
    severity: 'error',
    kind: 'internal',
    retryable: false,
  });

  // Enrich with request context
  const enrichedError = enrichError(kitiumError, {
    correlationId: req.headers['x-correlation-id'] as string,
    requestId: req.id,
    path: req.path,
    method: req.method,
  });

  // Log the error
  logError(enrichedError);

  // Send Problem Details response
  const problem = problemDetailsFrom(enrichedError);
  res.status(problem.status || 500).json(problem);
});
```

### Running operations with built-in retry semantics

```ts
import { runWithRetry, DependencyError } from '@kitiumai/error';

const result = await runWithRetry(
  async () => {
    const response = await fetch('https://example.com/api');
    if (!response.ok) {
      throw new DependencyError({
        code: 'dependency/upstream_unavailable',
        message: 'Partner API unavailable',
        retryDelay: 500,
        maxRetries: 3,
      });
    }
    return response.json();
  },
  {
    maxAttempts: 4,
    onAttempt: (attempt, error) => console.warn('retry attempt', attempt, error.code),
  }
);

if (result.error) {
  // Exhausted retries; result.error is a KitiumError
}
```

### Recording enriched exceptions into tracing spans

```ts
import { context, trace } from '@opentelemetry/api';
import { recordException, toKitiumError } from '@kitiumai/error';

const span = trace.getSpan(context.active());
try {
  await doWork();
} catch (err) {
  const kitium = toKitiumError(err);
  recordException(kitium, span);
  throw kitium;
}
```

### Error Registry Pattern

```ts
import { createErrorRegistry } from '@kitiumai/error';

// Create a custom registry for your service
const userServiceRegistry = createErrorRegistry({
  statusCode: 500,
  severity: 'error',
  kind: 'internal',
  retryable: false,
  docs: 'https://docs.kitium.ai/errors/user-service',
});

// Register service-specific errors
userServiceRegistry.register({
  code: 'user/not_found',
  message: 'User not found',
  statusCode: 404,
  severity: 'warning',
  kind: 'not_found',
  retryable: false,
});

userServiceRegistry.register({
  code: 'user/email_taken',
  message: 'Email address already in use',
  statusCode: 409,
  severity: 'warning',
  kind: 'conflict',
  retryable: false,
});

// Use the registry
const error = new KitiumError({
  code: 'user/not_found',
  message: 'User with ID 123 not found',
  kind: 'not_found',
  context: { userId: '123' },
});

const problem = userServiceRegistry.toProblemDetails(error);
```

### Using Typed Error Subclasses

```ts
import {
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  DependencyError,
  BusinessError,
  InternalError,
} from '@kitiumai/error';

// Validation errors (default: 400, warning)
function validateEmail(email: string) {
  if (!email) {
    throw new ValidationError({
      code: 'validation/required_field',
      message: 'Email is required',
      context: { field: 'email' },
    });
  }
  if (!email.includes('@')) {
    throw new ValidationError({
      code: 'validation/invalid_format',
      message: 'Email must be a valid email address',
      context: { field: 'email', value: email },
    });
  }
}

// Authentication errors (default: 401, error)
function authenticate(token: string) {
  if (!isValidToken(token)) {
    throw new AuthenticationError({
      code: 'auth/invalid_token',
      message: 'Invalid authentication token',
      context: { tokenLength: token.length },
    });
  }
}

// Authorization errors (default: 403, warning)
function authorize(userId: string, resource: string) {
  if (!hasPermission(userId, resource)) {
    throw new AuthorizationError({
      code: 'auth/insufficient_permissions',
      message: 'Insufficient permissions to access resource',
      context: { userId, resource },
    });
  }
}

// Not found errors (default: 404, warning)
async function getUser(userId: string) {
  const user = await db.users.findById(userId);
  if (!user) {
    throw new NotFoundError({
      code: 'user/not_found',
      message: 'User not found',
      context: { userId },
    });
  }
  return user;
}

// Conflict errors (default: 409, warning)
async function createUser(email: string) {
  const existing = await db.users.findByEmail(email);
  if (existing) {
    throw new ConflictError({
      code: 'user/email_taken',
      message: 'Email address already in use',
      context: { email },
    });
  }
}

// Rate limit errors (default: 429, warning, retryable)
async function checkRateLimit(userId: string) {
  const count = await rateLimiter.getCount(userId);
  if (count >= MAX_REQUESTS) {
    throw new RateLimitError({
      code: 'rate_limit/exceeded',
      message: 'Rate limit exceeded. Please try again later.',
      retryDelay: 2000, // 2 seconds
      maxRetries: 3,
      context: { userId, limit: MAX_REQUESTS },
    });
  }
}

// Dependency errors (default: 502, error, retryable)
async function callExternalService(url: string) {
  try {
    return await fetch(url);
  } catch (error) {
    throw new DependencyError({
      code: 'dependency/service_unavailable',
      message: 'External service unavailable',
      retryDelay: 1000,
      maxRetries: 5,
      backoff: 'exponential',
      context: { url },
      cause: error,
    });
  }
}

// Business logic errors (default: 400, error, non-retryable)
function processPayment(amount: number, balance: number) {
  if (amount > balance) {
    throw new BusinessError({
      code: 'payment/insufficient_funds',
      message: 'Insufficient funds for transaction',
      context: { amount, balance },
    });
  }
}

// Internal errors (default: 500, error, non-retryable)
function criticalOperation() {
  try {
    // Some critical operation
  } catch (error) {
    throw new InternalError({
      code: 'internal/unexpected_error',
      message: 'An unexpected error occurred',
      cause: error,
    });
  }
}
```

### Retry Strategy Metadata

```ts
import { KitiumError } from '@kitiumai/error';

// Exponential backoff (recommended for transient errors)
const transientError = new KitiumError({
  code: 'dependency/timeout',
  message: 'Request timeout',
  statusCode: 504,
  severity: 'error',
  kind: 'dependency',
  retryable: true,
  retryDelay: 1000, // Initial delay: 1 second
  maxRetries: 3, // Maximum 3 retry attempts
  backoff: 'exponential', // Delays: 1s, 2s, 4s
});

// Linear backoff (constant delay between retries)
const linearRetryError = new KitiumError({
  code: 'dependency/rate_limited',
  message: 'Service rate limited',
  retryable: true,
  retryDelay: 2000, // 2 seconds between each retry
  maxRetries: 5,
  backoff: 'linear', // Delays: 2s, 2s, 2s, 2s, 2s
});

// Fixed delay (same as linear, but explicit)
const fixedRetryError = new KitiumError({
  code: 'dependency/temporary_unavailable',
  message: 'Service temporarily unavailable',
  retryable: true,
  retryDelay: 5000, // 5 seconds between retries
  maxRetries: 2,
  backoff: 'fixed', // Delays: 5s, 5s
});

// Implementing retry logic
async function retryWithBackoff<T>(fn: () => Promise<T>, error: KitiumError): Promise<T> {
  if (!error.retryable || !error.maxRetries) {
    throw error;
  }

  let delay = error.retryDelay || 1000;
  for (let attempt = 0; attempt < error.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === error.maxRetries - 1) throw err;

      await new Promise((resolve) => setTimeout(resolve, delay));

      // Calculate next delay based on backoff strategy
      if (error.backoff === 'exponential') {
        delay *= 2;
      } else if (error.backoff === 'linear' || error.backoff === 'fixed') {
        delay = error.retryDelay || 1000;
      }
    }
  }
  throw error;
}
```

### Error Metrics

```ts
import { getErrorMetrics, resetErrorMetrics } from '@kitiumai/error';

// Get current error metrics
const metrics = getErrorMetrics();
console.log(metrics);
// {
//   totalErrors: 150,
//   errorsByKind: {
//     validation: 50,
//     auth: 30,
//     rate_limit: 20,
//     not_found: 25,
//     conflict: 10,
//     dependency: 10,
//     business: 3,
//     internal: 2
//   },
//   errorsBySeverity: {
//     fatal: 0,
//     error: 100,
//     warning: 50,
//     info: 0,
//     debug: 0
//   },
//   retryableErrors: 75,
//   nonRetryableErrors: 75
// }

// Export metrics to monitoring system
function exportMetrics() {
  const metrics = getErrorMetrics();

  // Send to Prometheus, Datadog, etc.
  prometheus.gauge('errors_total').set(metrics.totalErrors);
  prometheus.gauge('errors_retryable').set(metrics.retryableErrors);
  prometheus.gauge('errors_non_retryable').set(metrics.nonRetryableErrors);

  Object.entries(metrics.errorsByKind).forEach(([kind, count]) => {
    prometheus.gauge('errors_by_kind', { kind }).set(count);
  });

  Object.entries(metrics.errorsBySeverity).forEach(([severity, count]) => {
    prometheus.gauge('errors_by_severity', { severity }).set(count);
  });
}

// Reset metrics (useful for testing)
resetErrorMetrics();
```

### Error Fingerprinting

```ts
import { getErrorFingerprint, httpErrorRegistry } from '@kitiumai/error';

// Automatic fingerprint generation
const err = new KitiumError({
  code: 'validation/required_field',
  message: 'Field is required',
  kind: 'validation',
});

const fingerprint = getErrorFingerprint(err);
// Returns: "validation/required_field:validation"

// Register with custom fingerprint for better grouping
httpErrorRegistry.register({
  code: 'validation/required_field',
  message: 'Field is required',
  kind: 'validation',
  fingerprint: 'validation-required-field', // Custom fingerprint
});

// Use fingerprint for error tracking
function trackError(error: KitiumError) {
  const fingerprint = getErrorFingerprint(error);

  // Send to error tracking service (Sentry, Rollbar, etc.)
  errorTrackingService.captureError(error, {
    fingerprint: [fingerprint],
    tags: {
      code: error.code,
      kind: error.kind,
      severity: error.severity,
    },
  });
}
```

### Error Normalization

```ts
import { toKitiumError, KitiumError } from '@kitiumai/error';

// Normalize unknown errors
try {
  await someOperation();
} catch (error) {
  // Convert any error to KitiumError
  const kitiumError = toKitiumError(error, {
    code: 'operation/failed',
    message: 'Operation failed',
    statusCode: 500,
    severity: 'error',
    kind: 'internal',
    retryable: false,
  });

  logError(kitiumError);
  throw kitiumError;
}

// Normalize with fallback
function safeOperation() {
  try {
    return riskyOperation();
  } catch (error) {
    // If error is already KitiumError, it's returned as-is
    // Otherwise, uses fallback
    return toKitiumError(error, {
      code: 'operation/unknown_error',
      message: 'An unknown error occurred',
      severity: 'error',
      kind: 'internal',
      retryable: false,
    });
  }
}
```

### Context Enrichment

```ts
import { enrichError, KitiumError } from '@kitiumai/error';

// Add context to existing errors
function handleRequest(error: KitiumError, req: Request) {
  // Enrich with request context
  const enriched = enrichError(error, {
    correlationId: req.headers['x-correlation-id'],
    requestId: req.id,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return enriched;
}

// Chain enrichment
function processError(error: KitiumError) {
  let enriched = error;

  // Add service context
  enriched = enrichError(enriched, {
    service: 'user-service',
    version: '1.2.3',
  });

  // Add deployment context
  enriched = enrichError(enriched, {
    environment: process.env.NODE_ENV,
    region: process.env.AWS_REGION,
  });

  return enriched;
}
```

## Error Code Conventions

Error codes must follow this pattern: `^[a-z0-9_]+(\/[a-z0-9_]+)*$`

### Examples

- ✅ `auth/forbidden`
- ✅ `validation/required_field`
- ✅ `internal/server_error`
- ✅ `rate_limit/exceeded`
- ❌ `Auth/Forbidden` (uppercase not allowed)
- ❌ `auth.forbidden` (dots not allowed, use slashes)
- ❌ `auth forbidden` (spaces not allowed)

### Best Practices

- Use hierarchical structure: `domain/error_type` or `service/action/error`
- Keep codes lowercase and descriptive
- Use underscores for multi-word segments: `required_field` not `requiredfield`
- Group related errors under the same domain prefix

## API Reference

### Core Classes

#### `KitiumError`

Base error class with rich metadata support. Extends native `Error` class.

**Constructor:**

```ts
constructor(shape: ErrorShape, validateCode?: boolean)
```

**Properties:**

```ts
class KitiumError extends Error {
  readonly code: string; // Error code (validated format)
  readonly message: string; // Human-readable message
  readonly statusCode?: number; // HTTP status code
  readonly severity: ErrorSeverity; // Error severity level
  readonly kind: ErrorKind; // Error category
  readonly retryable: boolean; // Whether error is retryable
  readonly retryDelay?: number; // Initial retry delay (ms)
  readonly maxRetries?: number; // Maximum retry attempts
  readonly backoff?: RetryBackoff; // Backoff strategy
  readonly help?: string; // Help text for users
  readonly docs?: string; // Documentation URL
  readonly source?: string; // Error source/service
  readonly context?: ErrorContext; // Additional context
  readonly cause?: unknown; // Original error cause
}
```

**Methods:**

```ts
toJSON(): ErrorShape  // Serialize error to JSON
```

**Example:**

```ts
const error = new KitiumError({
  code: 'auth/forbidden',
  message: 'Access denied',
  statusCode: 403,
  severity: 'warning',
  kind: 'auth',
  retryable: false,
  context: { userId: '123' },
});

const json = error.toJSON();
// { code: 'auth/forbidden', message: 'Access denied', ... }
```

#### Typed Error Subclasses

All subclasses extend `KitiumError` and provide sensible defaults:

**`ValidationError`**

- Default: `statusCode: 400`, `severity: 'warning'`, `retryable: false`
- Use for: Input validation, schema validation, format errors

**`AuthenticationError`**

- Default: `statusCode: 401`, `severity: 'error'`, `retryable: false`
- Use for: Invalid credentials, expired tokens, missing authentication

**`AuthorizationError`**

- Default: `statusCode: 403`, `severity: 'warning'`, `retryable: false`
- Use for: Insufficient permissions, forbidden actions

**`NotFoundError`**

- Default: `statusCode: 404`, `severity: 'warning'`, `retryable: false`
- Use for: Missing resources, invalid IDs

**`ConflictError`**

- Default: `statusCode: 409`, `severity: 'warning'`, `retryable: false`
- Use for: Resource conflicts, duplicate entries, optimistic locking failures

**`RateLimitError`**

- Default: `statusCode: 429`, `severity: 'warning'`, `retryable: true`, `backoff: 'exponential'`
- Use for: Rate limiting, throttling

**`DependencyError`**

- Default: `statusCode: 502`, `severity: 'error'`, `retryable: true`, `backoff: 'exponential'`, `maxRetries: 3`
- Use for: External service failures, timeouts, network errors

**`BusinessError`**

- Default: `statusCode: 400`, `severity: 'error'`, `retryable: false`
- Use for: Business rule violations, domain logic errors

**`InternalError`**

- Default: `statusCode: 500`, `severity: 'error'`, `retryable: false`
- Use for: Unexpected internal errors, system failures

### Functions

#### `createErrorRegistry(defaults?)`

Creates a new error registry for centralized error management.

**Signature:**

```ts
function createErrorRegistry(defaults?: Partial<ErrorRegistryEntry>): ErrorRegistry;
```

**Parameters:**

- `defaults` (optional): Default values for error registry entries

**Returns:** `ErrorRegistry` object with `register()`, `resolve()`, and `toProblemDetails()` methods

**Example:**

```ts
const registry = createErrorRegistry({
  statusCode: 500,
  severity: 'error',
  kind: 'internal',
  docs: 'https://docs.example.com/errors',
});

registry.register({
  code: 'user/not_found',
  message: 'User not found',
  statusCode: 404,
  kind: 'not_found',
});

const entry = registry.resolve('user/not_found');
```

#### `toKitiumError(error, fallback?)`

Normalizes unknown errors into `KitiumError` instances.

**Signature:**

```ts
function toKitiumError(error: unknown, fallback?: ErrorShape): KitiumError;
```

**Parameters:**

- `error`: Any error value (Error, object, string, etc.)
- `fallback` (optional): Default error shape if normalization fails

**Returns:** `KitiumError` instance

**Example:**

```ts
try {
  await riskyOperation();
} catch (error) {
  const kitiumError = toKitiumError(error, {
    code: 'operation/failed',
    message: 'Operation failed',
    severity: 'error',
    kind: 'internal',
    retryable: false,
  });
}
```

#### `enrichError(error, context)`

Safely merges additional context into an error, creating a new error instance.

**Signature:**

```ts
function enrichError(error: KitiumError, context: Record<string, unknown>): KitiumError;
```

**Parameters:**

- `error`: `KitiumError` instance to enrich
- `context`: Additional context to merge

**Returns:** New `KitiumError` instance with merged context

**Example:**

```ts
const error = new KitiumError({
  /* ... */
});
const enriched = enrichError(error, {
  correlationId: 'corr-123',
  requestId: 'req-456',
});
```

#### `logError(error)`

Logs error with structured logging, including fingerprint and retry metadata.

**Signature:**

```ts
function logError(error: KitiumError): void;
```

**Parameters:**

- `error`: `KitiumError` instance to log

**Example:**

```ts
const error = new KitiumError({
  /* ... */
});
logError(error);
// Logs with appropriate severity level via @kitiumai/logger
```

#### `problemDetailsFrom(error)`

Converts error to RFC 7807 Problem Details format for HTTP responses.

**Signature:**

```ts
function problemDetailsFrom(error: KitiumError): ProblemDetails;
```

**Parameters:**

- `error`: `KitiumError` instance

**Returns:** `ProblemDetails` object compliant with RFC 7807

**Example:**

```ts
const error = new KitiumError({
  /* ... */
});
const problem = problemDetailsFrom(error);
// {
//   type: 'https://docs.kitium.ai/errors/auth/forbidden',
//   title: 'Access denied',
//   status: 403,
//   instance: 'corr-123',
//   extensions: { code: 'auth/forbidden', ... }
// }
```

#### `isValidErrorCode(code)`

Validates error code format without throwing.

**Signature:**

```ts
function isValidErrorCode(code: string): boolean;
```

**Parameters:**

- `code`: Error code to validate

**Returns:** `true` if valid, `false` otherwise

**Example:**

```ts
isValidErrorCode('auth/forbidden'); // true
isValidErrorCode('Auth/Forbidden'); // false
isValidErrorCode('auth.forbidden'); // false
```

#### `validateErrorCode(code)`

Validates error code format and throws if invalid.

**Signature:**

```ts
function validateErrorCode(code: string): void;
```

**Parameters:**

- `code`: Error code to validate

**Throws:** `Error` if code format is invalid

**Example:**

```ts
try {
  validateErrorCode('invalid code');
} catch (error) {
  // Error: Invalid error code format: "invalid code"...
}
```

#### `getErrorFingerprint(error)`

Generates fingerprint for error grouping in observability systems.

**Signature:**

```ts
function getErrorFingerprint(error: KitiumError | ErrorShape): string;
```

**Parameters:**

- `error`: `KitiumError` instance or `ErrorShape` object

**Returns:** Fingerprint string for error grouping

**Example:**

```ts
const error = new KitiumError({ code: 'auth/forbidden', kind: 'auth' });
const fingerprint = getErrorFingerprint(error);
// "auth/forbidden:auth"
```

#### `getErrorMetrics()`

Returns current error metrics snapshot.

**Signature:**

```ts
function getErrorMetrics(): ErrorMetrics;
```

**Returns:** `ErrorMetrics` object with error statistics

**Example:**

```ts
const metrics = getErrorMetrics();
console.log(metrics.totalErrors);
console.log(metrics.errorsByKind);
```

#### `resetErrorMetrics()`

Resets error metrics (useful for testing).

**Signature:**

```ts
function resetErrorMetrics(): void;
```

**Example:**

```ts
beforeEach(() => {
  resetErrorMetrics();
});
```

### Types

#### `ErrorSeverity`

Error severity levels for logging and monitoring.

```ts
type ErrorSeverity = 'fatal' | 'error' | 'warning' | 'info' | 'debug';
```

- `fatal`: Critical errors that cause system shutdown
- `error`: Errors that require attention
- `warning`: Warnings that may indicate issues
- `info`: Informational messages
- `debug`: Debug-level messages

#### `ErrorKind`

Error categories for classification and metrics.

```ts
type ErrorKind =
  | 'business' // Business logic violations
  | 'validation' // Input validation errors
  | 'auth' // Authentication/authorization errors
  | 'rate_limit' // Rate limiting errors
  | 'not_found' // Resource not found
  | 'conflict' // Resource conflicts
  | 'dependency' // External dependency failures
  | 'internal'; // Internal system errors
```

#### `RetryBackoff`

Backoff strategies for retry logic.

```ts
type RetryBackoff = 'linear' | 'exponential' | 'fixed';
```

- `linear`: Constant delay between retries
- `exponential`: Exponential backoff (delay doubles each retry)
- `fixed`: Same as linear (constant delay)

#### `ErrorContext`

Context object for error metadata and tracing.

```ts
interface ErrorContext {
  correlationId?: string; // Request correlation ID
  requestId?: string; // Unique request identifier
  spanId?: string; // Distributed tracing span ID
  tenantId?: string; // Multi-tenant tenant ID
  userId?: string; // User identifier
  [key: string]: unknown; // Additional custom fields
}
```

**Example:**

```ts
const context: ErrorContext = {
  correlationId: 'corr-123',
  requestId: 'req-456',
  spanId: 'span-789',
  tenantId: 'tenant-abc',
  userId: 'user-xyz',
  customField: 'custom-value',
};
```

#### `ErrorShape`

Complete error shape interface.

```ts
interface ErrorShape {
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
```

#### `ProblemDetails`

RFC 7807 Problem Details format.

```ts
interface ProblemDetails {
  readonly type?: string; // URI reference identifying problem type
  readonly title: string; // Short summary
  readonly status?: number; // HTTP status code
  readonly detail?: string; // Detailed explanation
  readonly instance?: string; // URI reference identifying specific occurrence
  readonly extensions?: Record<string, unknown>; // Additional properties
}
```

#### `ErrorMetrics`

Error metrics snapshot.

```ts
interface ErrorMetrics {
  readonly totalErrors: number;
  readonly errorsByKind: Record<ErrorKind, number>;
  readonly errorsBySeverity: Record<ErrorSeverity, number>;
  readonly retryableErrors: number;
  readonly nonRetryableErrors: number;
}
```

#### `ErrorRegistry`

Error registry interface.

```ts
interface ErrorRegistry {
  register(entry: ErrorRegistryEntry): void;
  resolve(code: string): ErrorRegistryEntry | undefined;
  toProblemDetails(error: ErrorShape): ProblemDetails;
}
```

#### `ErrorRegistryEntry`

Error registry entry with optional fingerprint and custom Problem Details renderer.

```ts
interface ErrorRegistryEntry extends ErrorShape {
  readonly fingerprint?: string;
  readonly toProblem?: (error: ErrorShape) => ProblemDetails;
}
```

## Advanced Usage

### Custom Problem Details Rendering

```ts
import { createErrorRegistry } from '@kitiumai/error';

const registry = createErrorRegistry();

registry.register({
  code: 'validation/field_error',
  message: 'Validation failed',
  kind: 'validation',
  toProblem: (error) => ({
    type: 'https://api.example.com/errors/validation',
    title: error.message,
    status: 400,
    detail: error.help,
    extensions: {
      code: error.code,
      fields: error.context?.fields || [],
    },
  }),
});
```

### Error Handling in Async Functions

```ts
import { toKitiumError, logError } from '@kitiumai/error';

async function asyncOperation() {
  try {
    return await riskyOperation();
  } catch (error) {
    const kitiumError = toKitiumError(error, {
      code: 'operation/failed',
      message: 'Operation failed',
      severity: 'error',
      kind: 'internal',
      retryable: false,
    });

    logError(kitiumError);
    throw kitiumError;
  }
}
```

### Error Handling in Express Routes

```ts
import express from 'express';
import { ValidationError, NotFoundError, problemDetailsFrom, logError } from '@kitiumai/error';

const router = express.Router();

router.get('/users/:id', async (req, res, next) => {
  try {
    const user = await getUserById(req.params.id);
    if (!user) {
      throw new NotFoundError({
        code: 'user/not_found',
        message: 'User not found',
        context: { userId: req.params.id },
      });
    }
    res.json(user);
  } catch (error) {
    next(error);
  }
});

// Error handler middleware
router.use(
  (error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error instanceof ValidationError || error instanceof NotFoundError) {
      logError(error);
      const problem = problemDetailsFrom(error);
      return res.status(problem.status || 500).json(problem);
    }
    next(error);
  }
);
```

### Integration with Error Tracking Services

```ts
import * as Sentry from '@sentry/node';
import { getErrorFingerprint, logError } from '@kitiumai/error';

function trackError(error: KitiumError) {
  const fingerprint = getErrorFingerprint(error);

  Sentry.withScope((scope) => {
    scope.setFingerprint([fingerprint]);
    scope.setTag('error_code', error.code);
    scope.setTag('error_kind', error.kind);
    scope.setTag('error_severity', error.severity);
    scope.setContext('error', {
      code: error.code,
      kind: error.kind,
      retryable: error.retryable,
      context: error.context,
    });

    Sentry.captureException(error);
  });

  logError(error);
}
```

## Best Practices

1. **Use Typed Subclasses**: Prefer typed error subclasses over base `KitiumError` for better type safety
2. **Register Errors Early**: Register error definitions in application startup
3. **Enrich Context**: Add correlation IDs, request IDs, and other tracing context
4. **Log Before Throwing**: Always log errors before throwing or returning
5. **Use Problem Details**: Convert errors to Problem Details format for HTTP responses
6. **Validate Error Codes**: Follow error code conventions for consistency
7. **Track Metrics**: Export error metrics to monitoring systems
8. **Handle Retries**: Use retry metadata for implementing retry logic
9. **Document Errors**: Provide documentation URLs for each error code
10. **Normalize Unknown Errors**: Use `toKitiumError()` to handle unexpected errors

## Publishing

The package is configured for public npm publishing via `publishConfig.access = public`.
