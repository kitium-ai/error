# @kitiumai/error

> **Enterprise-grade error primitives for modern applications**

`@kitiumai/error` is a comprehensive TypeScript error handling library that provides structured error management, RFC 7807 Problem Details compliance, retry semantics, observability integration, and enterprise-grade error taxonomy. Designed for large-scale applications that require consistent error handling across distributed systems.

## What is this package?

`@kitiumai/error` is a TypeScript-first error handling library that provides:

- **Structured Error Classes**: Typed error classes with rich metadata for consistent error representation
- **Error Registry System**: Centralized error code management with defaults and validation
- **RFC 7807 Compliance**: Full Problem Details standard implementation for HTTP APIs
- **Retry Semantics**: Built-in retry metadata and execution helpers with configurable backoff strategies
- **Observability Integration**: Error fingerprinting, metrics collection, and tracing support
- **Internationalization**: i18n support with parameterized error messages
- **Rate Limiting**: Built-in rate limit error handling with retry metadata
- **PII Redaction**: Automatic sensitive data redaction for logging and monitoring

## Why we need this package

Modern applications face complex error handling challenges:

### The Problem

- **Inconsistent Error Types**: Different services use different error formats
- **Poor Observability**: Errors lack context for debugging and monitoring
- **HTTP API Inconsistencies**: No standardized error response format
- **Retry Logic Complexity**: Manual retry implementation leads to bugs
- **PII Exposure**: Sensitive data leaks through error logs
- **Internationalization Gaps**: Error messages not localized for users
- **Rate Limiting Issues**: No standardized way to handle rate limit errors

### The Solution

`@kitiumai/error` provides a single source of truth for error handling that:

- **Standardizes Error Format**: Consistent error structure across all services
- **Enhances Observability**: Rich metadata for better monitoring and debugging
- **Ensures API Consistency**: RFC 7807 compliance for predictable HTTP responses
- **Simplifies Retry Logic**: Built-in retry helpers with proven strategies
- **Protects User Privacy**: Automatic PII redaction
- **Supports Globalization**: i18n-ready error messages
- **Handles Scale**: Rate limiting and dependency error management

## Competitor Comparison

| Feature                 | @kitiumai/error             | Google APIs     | AWS SDK         | Stripe API      | Apollo GraphQL |
| ----------------------- | --------------------------- | --------------- | --------------- | --------------- | -------------- |
| **Error Taxonomy**      | ✅ Typed classes            | ❌ Manual codes | ❌ Inconsistent | ❌ Manual codes | ❌ Basic types |
| **RFC 7807 Support**    | ✅ Full compliance          | ❌ Partial      | ❌ None         | ❌ None         | ❌ None        |
| **Retry Semantics**     | ✅ Built-in helpers         | ❌ Manual       | ❌ Manual       | ❌ Manual       | ❌ Manual      |
| **Observability**       | ✅ Fingerprinting + metrics | ❌ Basic        | ❌ Basic        | ❌ Basic        | ❌ Basic       |
| **PII Redaction**       | ✅ Configurable             | ❌ None         | ❌ None         | ❌ None         | ❌ None        |
| **i18n Support**        | ✅ Parameterized messages   | ❌ None         | ❌ None         | ❌ None         | ❌ None        |
| **Rate Limiting**       | ✅ Built-in types           | ❌ Manual       | ❌ Manual       | ❌ Manual       | ❌ Manual      |
| **TypeScript First**    | ✅ Strict types             | ❌ JavaScript   | ❌ JavaScript   | ❌ JavaScript   | ❌ JavaScript  |
| **Registry System**     | ✅ Centralized              | ❌ None         | ❌ None         | ❌ None         | ❌ None        |
| **Tracing Integration** | ✅ OpenTelemetry            | ❌ None         | ❌ None         | ❌ None         | ❌ None        |

## Unique Selling Proposition (USP)

### **Enterprise-Grade Error Handling**

While other libraries provide basic error classes, `@kitiumai/error` delivers enterprise-grade error management that scales with your business:

- **Big Tech Standards**: Implements patterns used by Google, AWS, and Stripe
- **Production Ready**: Used in high-traffic production environments
- **Developer Experience**: TypeScript-first with excellent DX
- **Compliance Ready**: PII redaction and audit trails built-in
- **Future Proof**: Extensible design for evolving requirements

### **Single Source of Truth**

Centralized error management eliminates inconsistencies across services:

- **Registry-Driven**: All error definitions in one place
- **Validation**: Automatic error code format validation
- **Documentation**: Auto-generated documentation URLs
- **Metrics**: Built-in error tracking and reporting
- **Governance**: Lifecycle management for error evolution

### **Observability Excellence**

Superior monitoring and debugging capabilities:

- **Error Fingerprinting**: Automatic error grouping for alert reduction
- **Rich Context**: Correlation IDs, request IDs, and custom metadata
- **Tracing Integration**: OpenTelemetry span enrichment
- **Metrics Collection**: Real-time error statistics
- **PII Protection**: Safe logging without data leaks

## Installation

```bash
npm install @kitiumai/error
# or
pnpm add @kitiumai/error
# or
yarn add @kitiumai/error
```

## Quick Start

```ts
import {
  KitiumError,
  ValidationError,
  httpErrorRegistry,
  problemDetailsFrom,
  logError,
} from '@kitiumai/error';

// Register your error definitions
httpErrorRegistry.register({
  code: 'user/not_found',
  message: 'User not found',
  statusCode: 404,
  severity: 'warning',
  kind: 'not_found',
  retryable: false,
  docs: 'https://docs.kitium.ai/errors/user_not_found',
});

// Create and handle errors
try {
  throw new ValidationError({
    code: 'validation/invalid_email',
    message: 'Invalid email format',
    context: { email: 'invalid-email' },
  });
} catch (error) {
  logError(error);
  const problem = problemDetailsFrom(error);
  // Send RFC 7807 compliant response
}
```

## Core Concepts

### Error Taxonomy

Errors are categorized by **kind** and **severity** for consistent handling:

```ts
type ErrorKind =
  | 'business' // Business rule violations
  | 'validation' // Input validation errors
  | 'auth' // Authentication/authorization
  | 'rate_limit' // Rate limiting
  | 'not_found' // Resource not found
  | 'conflict' // Resource conflicts
  | 'dependency' // External service failures
  | 'internal'; // System errors

type ErrorSeverity = 'fatal' | 'error' | 'warning' | 'info' | 'debug';
```

### Error Registry

Centralized error management with defaults and validation:

```ts
import { createErrorRegistry } from '@kitiumai/error';

const userRegistry = createErrorRegistry({
  statusCode: 500,
  severity: 'error',
  kind: 'internal',
  docs: 'https://docs.kitium.ai/errors/user-service',
});

userRegistry.register({
  code: 'user/email_taken',
  message: 'Email address already in use',
  statusCode: 409,
  kind: 'conflict',
});
```

### RFC 7807 Problem Details

Standardized HTTP error responses:

```ts
const error = new KitiumError({
  code: 'auth/forbidden',
  message: 'Access denied',
  statusCode: 403,
});

const problem = problemDetailsFrom(error);
// {
//   "type": "https://docs.kitium.ai/errors/auth/forbidden",
//   "title": "Access denied",
//   "status": 403,
//   "instance": "req-123",
//   "extensions": {
//     "code": "auth/forbidden",
//     "severity": "warning",
//     "kind": "auth"
//   }
// }
```

## API Reference

### Core Classes

#### `KitiumError`

The base error class with rich metadata support.

```ts
class KitiumError extends Error {
  constructor(shape: ErrorShape, validateCode?: boolean);

  // Core properties
  readonly code: string;
  readonly message: string;
  readonly statusCode?: number;
  readonly severity: ErrorSeverity;
  readonly kind: ErrorKind;
  readonly retryable: boolean;

  // Retry metadata
  readonly retryDelay?: number;
  readonly maxRetries?: number;
  readonly backoff?: RetryBackoff;

  // Additional metadata
  readonly help?: string;
  readonly docs?: string;
  readonly source?: string;
  readonly context?: ErrorContext;
  readonly cause?: unknown;

  // New features
  readonly i18nKey?: string;
  readonly i18nParams?: Record<string, unknown>;
  readonly rateLimit?: RateLimitInfo;

  // Methods
  toJSON(): ErrorShape;
}
```

#### Typed Error Subclasses

**`ValidationError`** - Input validation errors (400, warning)
**`AuthenticationError`** - Auth failures (401, error)
**`AuthorizationError`** - Permission denied (403, warning)
**`NotFoundError`** - Resource not found (404, warning)
**`ConflictError`** - Resource conflicts (409, warning)
**`RateLimitError`** - Rate limiting (429, warning, retryable)
**`DependencyError`** - External service failures (502, error, retryable)
**`BusinessError`** - Business logic violations (400, error)
**`InternalError`** - System failures (500, error)

### Functions

#### Error Creation & Normalization

```ts
// Generate IDs
generateCorrelationId(): string;
generateRequestId(): string;
generateIdempotencyKey(): string;
generateDocumentationUrl(code: string): string;

// Create i18n messages
createI18nMessage(key: string, params?: Record<string, unknown>, fallback?: string): I18nMessage;

// Add i18n to errors
withI18n(error: KitiumError, i18nKey: string, params?: Record<string, unknown>, fallback?: string): KitiumError;

// Normalize unknown errors
toKitiumError(error: unknown, fallback?: ErrorShape): KitiumError;

// Enrich errors with context
enrichError(error: KitiumError, context: Record<string, unknown>): KitiumError;
```

#### Validation & Registry

```ts
// Error code validation
isValidErrorCode(code: string): boolean;
validateErrorCode(code: string): void;

// Registry management
createErrorRegistry(defaults?: Partial<ErrorRegistryEntry>): ErrorRegistry;
```

#### Observability & Monitoring

```ts
// Logging
logError(error: KitiumError): void;

// Tracing
recordException(error: KitiumError, span?: TraceSpanLike): void;

// Metrics
getErrorMetrics(): ErrorMetrics;
resetErrorMetrics(): void;

// Fingerprinting
getErrorFingerprint(error: KitiumError | ErrorShape): string;
```

#### HTTP & Serialization

```ts
// RFC 7807 Problem Details
problemDetailsFrom(error: KitiumError): ProblemDetails;
```

#### Retry Execution

```ts
// Execute with retry semantics
runWithRetry<T>(
  operation: () => Promise<T>,
  options?: RetryOptions
): Promise<RetryOutcome<T>>;
```

### Types

#### Core Types

```ts
type ErrorSeverity = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

type ErrorKind =
  | 'business'
  | 'validation'
  | 'auth'
  | 'rate_limit'
  | 'not_found'
  | 'conflict'
  | 'dependency'
  | 'internal';

type RetryBackoff = 'linear' | 'exponential' | 'fixed';

interface ErrorContext {
  correlationId?: string;
  requestId?: string;
  idempotencyKey?: string;
  locale?: string;
  [key: string]: unknown;
}

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
  readonly userMessage?: string;
  readonly i18nKey?: string;
  readonly i18nParams?: Record<string, unknown>;
  readonly redact?: string[];
  readonly context?: ErrorContext;
  readonly rateLimit?: RateLimitInfo;
  readonly cause?: unknown;
}
```

#### New Types (Latest Features)

```ts
interface I18nMessage {
  readonly key: string;
  readonly params?: Record<string, unknown>;
  readonly fallback?: string;
}

interface RateLimitInfo {
  readonly limit?: number;
  readonly remaining?: number;
  readonly resetTime?: number;
}

interface RetryOptions {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly backoff?: RetryBackoff;
  readonly idempotencyKey?: string;
  readonly onAttempt?: (attempt: number, error: KitiumError) => void;
}

interface RetryOutcome<T> {
  readonly attempts: number;
  readonly result?: T;
  readonly error?: unknown;
  readonly lastDelayMs?: number;
}

interface ProblemDetails {
  readonly type?: string;
  readonly title: string;
  readonly status?: number;
  readonly detail?: string;
  readonly instance?: string;
  readonly extensions?: Record<string, unknown>;
}

interface ErrorMetrics {
  readonly totalErrors: number;
  readonly errorsByKind: Record<ErrorKind, number>;
  readonly errorsBySeverity: Record<ErrorSeverity, number>;
  readonly retryableErrors: number;
  readonly nonRetryableErrors: number;
}

interface ErrorRegistry {
  register(entry: ErrorRegistryEntry): void;
  resolve(code: string): ErrorRegistryEntry | undefined;
  toProblemDetails(error: ErrorShape): ProblemDetails;
}

interface ErrorRegistryEntry extends ErrorShape {
  readonly fingerprint?: string;
  readonly toProblem?: (error: ErrorShape) => ProblemDetails;
}

interface TraceSpanLike {
  setAttribute(key: string, value: unknown): void;
  recordException(exception: unknown): void;
}
```

## Usage Examples

### Basic Error Handling

```ts
import { KitiumError, logError, problemDetailsFrom } from '@kitiumai/error';

// Create typed error
const error = new KitiumError({
  code: 'auth/forbidden',
  message: 'Access denied to resource',
  statusCode: 403,
  severity: 'warning',
  kind: 'auth',
  retryable: false,
  context: {
    correlationId: 'corr-123',
    requestId: 'req-456',
    userId: 'user-789',
    resource: '/api/users',
  },
});

// Log with structured data
logError(error);

// Convert to HTTP response
const problem = problemDetailsFrom(error);
res.status(problem.status).json(problem);
```

### Typed Subclass Usage

```ts
import {
  ValidationError,
  AuthenticationError,
  NotFoundError,
  RateLimitError,
} from '@kitiumai/error';

// Validation errors
function validateUser(userData: any) {
  if (!userData.email) {
    throw new ValidationError({
      code: 'validation/required_field',
      message: 'Email is required',
      context: { field: 'email' },
    });
  }
}

// Auth errors
function authenticate(token: string) {
  if (!isValidToken(token)) {
    throw new AuthenticationError({
      code: 'auth/invalid_token',
      message: 'Invalid authentication token',
      context: { tokenLength: token.length },
    });
  }
}

// Not found errors
async function getUser(id: string) {
  const user = await db.users.findById(id);
  if (!user) {
    throw new NotFoundError({
      code: 'user/not_found',
      message: 'User not found',
      context: { userId: id },
    });
  }
  return user;
}

// Rate limiting
function checkRateLimit(userId: string) {
  const remaining = getRemainingRequests(userId);
  if (remaining <= 0) {
    throw new RateLimitError({
      code: 'rate_limit/exceeded',
      message: 'Rate limit exceeded',
      retryDelay: 60000, // 1 minute
      context: { userId, limit: 100 },
      rateLimit: {
        limit: 100,
        remaining: 0,
        resetTime: Date.now() + 60000,
      },
    });
  }
}
```

### Retry with Built-in Semantics

```ts
import { runWithRetry, DependencyError } from '@kitiumai/error';

const result = await runWithRetry(
  async () => {
    const response = await fetch('https://api.example.com/data');
    if (!response.ok) {
      throw new DependencyError({
        code: 'dependency/api_error',
        message: 'External API error',
        statusCode: response.status,
        retryDelay: 1000,
        maxRetries: 3,
        backoff: 'exponential',
      });
    }
    return response.json();
  },
  {
    maxAttempts: 4,
    baseDelayMs: 500,
    backoff: 'exponential',
    idempotencyKey: 'retry-123',
    onAttempt: (attempt, error) => {
      console.log(`Retry attempt ${attempt} failed:`, error.message);
    },
  }
);

if (result.error) {
  console.error('All retry attempts failed:', result.error);
} else {
  console.log('Success:', result.result);
}
```

### Error Registry Pattern

```ts
import { createErrorRegistry } from '@kitiumai/error';

const apiRegistry = createErrorRegistry({
  statusCode: 500,
  severity: 'error',
  kind: 'internal',
  retryable: false,
  docs: 'https://docs.kitium.ai/errors/api',
});

// Register domain-specific errors
apiRegistry.register({
  code: 'api/validation_failed',
  message: 'Request validation failed',
  statusCode: 400,
  kind: 'validation',
  help: 'Check your request parameters',
});

apiRegistry.register({
  code: 'api/unauthorized',
  message: 'Authentication required',
  statusCode: 401,
  kind: 'auth',
  help: 'Provide valid authentication credentials',
});

// Use in error handling
try {
  validateRequest(req.body);
} catch (error) {
  const kitiumError = toKitiumError(error, {
    code: 'api/validation_failed',
    message: 'Invalid request data',
  });

  const problem = apiRegistry.toProblemDetails(kitiumError);
  res.status(problem.status).json(problem);
}
```

### Internationalization Support

```ts
import { createI18nMessage, withI18n, KitiumError } from '@kitiumai/error';

// Create i18n message
const i18nMsg = createI18nMessage(
  'validation.required_field',
  { field: 'email' },
  'The email field is required'
);

// Add i18n to error
const error = new KitiumError({
  code: 'validation/required_field',
  message: 'Email is required',
  kind: 'validation',
});

const localizedError = withI18n(
  error,
  'validation.required_field',
  { field: 'email' },
  'The email field is required'
);

// Error now has i18n metadata for frontend localization
console.log(localizedError.i18nKey); // 'validation.required_field'
console.log(localizedError.i18nParams); // { field: 'email' }
```

### Express.js Integration

```ts
import express from 'express';
import {
  KitiumError,
  toKitiumError,
  enrichError,
  problemDetailsFrom,
  logError,
} from '@kitiumai/error';

const app = express();

// Request context middleware
app.use((req, res, next) => {
  req.context = {
    correlationId: req.headers['x-correlation-id'] || generateCorrelationId(),
    requestId: generateRequestId(),
    path: req.path,
    method: req.method,
  };
  next();
});

// Error handling middleware
app.use(
  (error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    // Normalize error
    const kitiumError = toKitiumError(error, {
      code: 'internal/server_error',
      message: 'An unexpected error occurred',
      statusCode: 500,
      severity: 'error',
      kind: 'internal',
      retryable: false,
    });

    // Enrich with request context
    const enrichedError = enrichError(kitiumError, req.context);

    // Log error
    logError(enrichedError);

    // Send Problem Details response
    const problem = problemDetailsFrom(enrichedError);
    res.status(problem.status || 500).json(problem);
  }
);
```

### Tracing Integration

```ts
import { context, trace } from '@opentelemetry/api';
import { recordException, KitiumError } from '@kitiumai/error';

const tracer = trace.getTracer('my-service');

async function tracedOperation() {
  const span = tracer.startSpan('operation');
  try {
    await riskyOperation();
    span.setStatus({ code: trace.SpanStatusCode.OK });
  } catch (error) {
    const kitiumError = toKitiumError(error);
    recordException(kitiumError, span);
    span.setStatus({ code: trace.SpanStatusCode.ERROR, message: kitiumError.message });
    throw kitiumError;
  } finally {
    span.end();
  }
}
```

### Error Metrics & Monitoring

```ts
import { getErrorMetrics, resetErrorMetrics } from '@kitiumai/error';

// Get current metrics
const metrics = getErrorMetrics();
console.log('Total errors:', metrics.totalErrors);
console.log('Errors by kind:', metrics.errorsByKind);
console.log('Errors by severity:', metrics.errorsBySeverity);

// Export to monitoring system
function exportMetrics() {
  const metrics = getErrorMetrics();

  // Send to Prometheus/DataDog
  prometheus.gauge('errors_total').set(metrics.totalErrors);
  prometheus.gauge('errors_retryable').set(metrics.retryableErrors);

  Object.entries(metrics.errorsByKind).forEach(([kind, count]) => {
    prometheus.gauge('errors_by_kind', { kind }).set(count);
  });
}

// Reset for testing
resetErrorMetrics();
```

### Error Fingerprinting

```ts
import { getErrorFingerprint, KitiumError } from '@kitiumai/error';

const error = new KitiumError({
  code: 'validation/email_invalid',
  message: 'Invalid email format',
  kind: 'validation',
});

const fingerprint = getErrorFingerprint(error);
// Returns: "validation/email_invalid:validation"

// Use for error grouping in monitoring
Sentry.withScope((scope) => {
  scope.setFingerprint([fingerprint]);
  Sentry.captureException(error);
});
```

## Advanced Patterns

### Custom Error Registry with Overrides

```ts
import { createErrorRegistry } from '@kitiumai/error';

const registry = createErrorRegistry({
  statusCode: 500,
  severity: 'error',
  kind: 'internal',
});

// Custom Problem Details renderer
registry.register({
  code: 'validation/schema_error',
  message: 'Schema validation failed',
  kind: 'validation',
  toProblem: (error) => ({
    type: 'https://api.example.com/errors/validation',
    title: error.message,
    status: 400,
    detail: error.help,
    extensions: {
      code: error.code,
      fields: error.context?.fields || [],
      schema: error.context?.schema,
    },
  }),
});
```

### Circuit Breaker Pattern

```ts
import { DependencyError, runWithRetry } from '@kitiumai/error';

class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  async call(operation: () => Promise<any>) {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > 60000) {
        // 1 minute timeout
        this.state = 'half-open';
      } else {
        throw new DependencyError({
          code: 'dependency/circuit_open',
          message: 'Circuit breaker is open',
          retryable: true,
          retryDelay: 30000,
        });
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failures = 0;
    this.state = 'closed';
  }

  private onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= 5) {
      this.state = 'open';
    }
  }
}
```

### Error Boundary Pattern

```ts
import React from 'react';
import { KitiumError, toKitiumError } from '@kitiumai/error';

class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const kitiumError = toKitiumError(error, {
      code: 'ui/render_error',
      message: 'Component render failed',
      severity: 'error',
      kind: 'internal',
      context: {
        componentStack: errorInfo.componentStack,
        errorBoundary: this.constructor.name,
      },
    });

    logError(kitiumError);
  }

  render() {
    if (this.state.error) {
      return <div>Something went wrong. Please try again.</div>;
    }
    return this.props.children;
  }
}
```

## Best Practices

### 1. Use Typed Error Subclasses

```ts
// ✅ Good
throw new ValidationError({ code: 'validation/invalid_email', ... });

// ❌ Avoid
throw new KitiumError({ code: 'validation/invalid_email', ... });
```

### 2. Register Errors Early

```ts
// ✅ Register at startup
app.on('ready', () => {
  httpErrorRegistry.register(userErrors);
  httpErrorRegistry.register(apiErrors);
});
```

### 3. Enrich Context Immediately

```ts
// ✅ Enrich when error occurs
try {
  await operation();
} catch (error) {
  const enriched = enrichError(error, {
    correlationId: req.correlationId,
    userId: req.user.id,
  });
  throw enriched;
}
```

### 4. Use Problem Details for APIs

```ts
// ✅ Standardized responses
const problem = problemDetailsFrom(error);
res.status(problem.status).json(problem);
```

### 5. Implement Retry Logic

```ts
// ✅ Use built-in retry
const result = await runWithRetry(operation, {
  maxAttempts: 3,
  backoff: 'exponential',
});
```

### 6. Protect Sensitive Data

```ts
// ✅ Automatic redaction
httpErrorRegistry.register({
  code: 'auth/login_failed',
  message: 'Login failed',
  redact: ['context.password', 'context.token'],
});
```

### 7. Monitor Error Metrics

```ts
// ✅ Track and alert
const metrics = getErrorMetrics();
if (metrics.errorsBySeverity.error > 100) {
  alert('High error rate detected');
}
```

## Migration Guide

### From Generic Errors

```ts
// Before
throw new Error('User not found');

// After
throw new NotFoundError({
  code: 'user/not_found',
  message: 'User not found',
  context: { userId },
});
```

### From Manual HTTP Responses

```ts
// Before
res.status(404).json({ error: 'Not found' });

// After
const problem = problemDetailsFrom(error);
res.status(problem.status).json(problem);
```

### From Basic Retry Logic

```ts
// Before
let attempts = 0;
while (attempts < 3) {
  try {
    return await operation();
  } catch (error) {
    attempts++;
    await delay(1000 * attempts);
  }
}

// After
return await runWithRetry(operation, {
  maxAttempts: 3,
  backoff: 'exponential',
});
```

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for development setup and contribution guidelines.

## License

MIT
