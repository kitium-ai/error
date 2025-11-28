# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v2.0.0] - 2025-11-28

### Added

- Lifecycle metadata validation and schema version tags on errors and registry entries to support governed evolution.
- Redaction-aware context handling and safe user messaging in JSON serialization and RFC 7807 Problem Details rendering.
- Tracing (`recordException`) and retry (`runWithRetry`) helpers that propagate retry metadata, backoff choices, and attempt counts.

### Changed

- Default Problem Details output now prioritizes registry-provided docs, lifecycle, and schema version metadata when present.

## [1.0.0] - 2024-12-19

### Added

#### Core Features

- **KitiumError class**: Enterprise-grade error class with rich metadata support
  - Error code, message, HTTP status code
  - Severity levels: `fatal`, `error`, `warning`, `info`, `debug`
  - Error kinds: `business`, `validation`, `auth`, `rate_limit`, `not_found`, `conflict`, `dependency`, `internal`
  - Retryability flag with detailed retry strategy metadata
  - Context support for correlation IDs, request IDs, span IDs, tenant/user IDs
  - Source tracking and documentation URLs
  - Error cause chain support
  - Full JSON serialization via `toJSON()` method

#### Error Registry System

- **Error Registry API**: Centralized error code management
  - `createErrorRegistry()` - Create custom error registries with defaults
  - `httpErrorRegistry` - Pre-configured HTTP error registry
  - `register()` - Register error definitions with defaults
  - `resolve()` - Resolve error definitions by code
  - Custom Problem Details rendering via `toProblem` hooks
  - Error fingerprinting support for observability grouping

#### RFC 7807 Problem Details Support

- Full compliance with [RFC 7807 Problem Details for HTTP APIs](https://tools.ietf.org/html/rfc7807)
- `problemDetailsFrom()` - Convert errors to Problem Details format
- Automatic type URL generation from documentation URLs
- Extensible extensions object with error metadata
- Instance field support via correlation/request IDs

#### Retry Strategy Metadata

- **Retry Information**: Detailed retry strategy support
  - `retryable` - Boolean flag for retry eligibility
  - `retryDelay` - Initial retry delay in milliseconds
  - `maxRetries` - Maximum number of retry attempts
  - `backoff` - Backoff strategy: `linear`, `exponential`, or `fixed`
  - Included in Problem Details extensions
  - Logged in structured error logs

#### Error Code Validation

- **Automatic Validation**: Error code format validation
  - Pattern: `^[a-z0-9_]+(\/[a-z0-9_]+)*$`
  - `isValidErrorCode()` - Check if error code format is valid
  - `validateErrorCode()` - Validate and throw on invalid format
  - Automatic validation in `KitiumError` constructor
  - Validation in registry registration
  - Clear error messages for invalid codes

#### Typed Error Subclasses

- **Type-Safe Error Classes**: Pre-configured error subclasses with sensible defaults
  - `ValidationError` - Validation errors (400, warning, non-retryable)
  - `AuthenticationError` - Authentication failures (401, error, non-retryable)
  - `AuthorizationError` - Authorization failures (403, warning, non-retryable)
  - `NotFoundError` - Resource not found (404, warning, non-retryable)
  - `ConflictError` - Resource conflicts (409, warning, non-retryable)
  - `RateLimitError` - Rate limiting (429, warning, retryable with exponential backoff)
  - `DependencyError` - External dependency failures (502, error, retryable with exponential backoff)
  - `BusinessError` - Business logic errors (400, error, non-retryable)
  - `InternalError` - Internal server errors (500, error, non-retryable)

#### Error Fingerprinting

- **Observability Support**: Error grouping for monitoring systems
  - `getErrorFingerprint()` - Generate fingerprint for error grouping
  - Registry-based fingerprint support
  - Automatic fingerprint generation from code and kind
  - Included in structured logging payload

#### Error Metrics

- **Built-in Metrics**: Error tracking and analytics
  - `getErrorMetrics()` - Get current error metrics snapshot
  - `resetErrorMetrics()` - Reset metrics (useful for testing)
  - Tracks: total errors, errors by kind, errors by severity
  - Tracks: retryable vs non-retryable error counts
  - Automatic metrics collection on error creation

#### Error Utilities

- **Helper Functions**: Utility functions for error handling
  - `toKitiumError()` - Normalize unknown errors to `KitiumError`
  - `enrichError()` - Safely merge additional context into errors
  - `logError()` - Structured logging with severity-aware routing
  - Integration with `@kitiumai/logger` for observability

#### Structured Logging

- **Severity-Aware Logging**: Automatic log routing by severity
  - `fatal`/`error` → `log.error()`
  - `warning` → `log.warn()`
  - `info` → `log.info()`
  - `debug` → `log.debug()`
  - Includes error code, message, severity, retry info, context, source, fingerprint

#### TypeScript Support

- **Full Type Safety**: Comprehensive TypeScript definitions
  - All types exported from `./types`
  - Strict type checking for error shapes
  - Type-safe error registry entries
  - Type-safe error context
  - Type-safe retry metadata

#### Documentation

- **Comprehensive Documentation**: Complete API reference
  - README with quick start guide
  - Error code conventions and best practices
  - Usage examples for all features
  - Type definitions and API reference
  - Evaluation document comparing with big tech companies

### Technical Details

#### Dependencies

- `@kitiumai/logger` - Structured logging integration
- `@kitiumai/types` - Shared type definitions
- `@kitiumai/utils-ts` - TypeScript utility functions

#### Build Configuration

- TypeScript 5.6+
- ESM and CommonJS dual package support
- Source maps for debugging
- Type definitions included
- ES2020 target

#### Package Exports

- ESM: `dist/index.mjs`
- CommonJS: `dist/index.js`
- TypeScript: `dist/index.d.ts`

### Standards Compliance

- ✅ **RFC 7807**: Full Problem Details for HTTP APIs compliance
- ✅ **TypeScript**: Strict type checking enabled
- ✅ **ESM/CommonJS**: Dual package support
- ✅ **Semantic Versioning**: Follows semver 2.0.0

### Comparison with Industry Standards

This package matches or exceeds error handling capabilities of:

- **Microsoft Azure**: RFC 7807 compliance, error registry pattern
- **Google Cloud**: Error registry, request tracking, structured errors
- **AWS**: Error codes, request IDs, retry information
- **Stripe**: Typed error classes, rich metadata, documentation links
- **GitHub**: Error codes, validation errors, rate limiting

### Migration Notes

This is the initial release (v1.0.0). No migration needed.

### Breaking Changes

None - this is the initial release.

### Deprecations

None - this is the initial release.

---

[Unreleased]: https://github.com/kitiumai/kitium/compare/%40kitiumai%2Ferror%401.0.0...HEAD
[1.0.0]: https://github.com/kitiumai/kitium/releases/tag/%40kitiumai%2Ferror%401.0.0
