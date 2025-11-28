# Error Platform Review and Recommendations

This review evaluates the current `@kitiumai/error` package against patterns commonly seen in mature error platforms at large-scale product companies (e.g., Microsoft, Google, AWS) and proposes improvements for consistency, API clarity, and operational robustness.

## Strengths

- **Unified error primitive**: `KitiumError` centralizes severity, kind, retry, and context metadata, enabling structured handling across services.
- **Registry-driven governance**: `createErrorRegistry` and `httpErrorRegistry` provide a single source of truth for error metadata and Problem Details generation.
- **Problem Details support**: Built-in RFC 7807 mapping (`problemDetailsFrom`) simplifies HTTP integration.
- **Observability hooks**: Fingerprinting, logging integration, and metrics counters offer a baseline for tracking errors.
- **Typed subclasses**: Domain-specific error subclasses (validation, auth, not found, etc.) encode sensible defaults for status, severity, and retry guidance.

## Gaps vs. big-tech expectations

1. **Error spec versioning and lifecycle**
   - Large companies track deprecation/rollout states for error codes (e.g., draft, active, deprecated) and versioned schemas for backward compatibility across services.
   - Current registry entries do not include lifecycle metadata or enforced versioning for error shapes.

2. **Redaction and PII safety**
   - Enterprise platforms provide field-level redaction/anonymization for logs and Problem Details to avoid leaking PII.
   - `toJSON`, `logError`, and `problemDetailsFrom` merge `context` verbatim, risking sensitive fields surfacing in logs and client responses.

3. **Tracing and diagnostics hooks**
   - Industry-standard patterns (OpenTelemetry) attach span/trace IDs, set span status, and record exceptions automatically.
   - Current API exposes `context` but does not integrate with tracing SDKs or set span status on errors.

4. **Localization and user messaging**
   - Mature products separate developer-facing messages from customer-facing, localized messages, often via message catalogs keyed by error code.
   - Errors carry only a single `message` string with no locale-aware resolution or safe-client-facing title/detail separation.

5. **Categorization alignment and extensibility**
   - Big-tech taxonomies include richer dimensions (product surface, capability, SLA tier, security classification) and allow controlled extension without code changes.
   - `ErrorKind` is fixed at compile time; extending requires publishing new library versions rather than registry-driven configuration.

6. **Retry policy execution helpers**
   - Platforms often provide `withRetry`/`retryable` helpers that apply the embedded retry policy directly (delay/backoff/max retries) and emit metrics.
   - The package models retry metadata but leaves application of the policy to callers, leading to inconsistent behavior.

7. **Error wrapping and cause chains**
   - Rich error platforms retain causal chains with structured contexts (e.g., `Exception.Data`, `ErrorCause` linked lists) and safe serialization of nested causes.
   - `cause` is captured but not serialized deeply, and registry lookups ignore nested causes when generating fingerprints or Problem Details.

8. **Discoverability and governance tooling**
   - Enterprises ship CLIs or pipelines to lint, list, and publish error catalogs, ensuring codes are unique and documented.
   - Registry contents are in-memory only; there is no tooling to generate docs, validate duplicates, or publish schema bundles.

9. **Framework integrations**
   - Production teams expect adapters for common frameworks (Express/Fastify, GraphQL, tRPC, background job runners) to enforce consistent error responses.
   - README shows Express usage, but the package exports no middleware/factory helpers to standardize adoption across runtimes.

10. **Metrics and alerting depth**
    - Big-tech setups emit dimensional metrics (by code/kind/severity/service) to observability backends and wire alerts on budgets/SLOs.
    - Current metrics are in-memory counters without export hooks; they will not integrate with Prometheus/OpenTelemetry without manual glue.

## Recommendations

### API and type consistency
- Add **error schema version** and **lifecycle state** (`draft` | `active` | `deprecated`) to `ErrorRegistryEntry`, enforcing validation during registration.
- Allow **extensible kinds** by letting registries accept string literals beyond the default enum, while preserving a core recommended set.
- Provide **factory helpers** that generate typed error classes from registry entries to keep enums and registries aligned without manual subclassing.

### Safety and compliance
- Introduce **redaction rules** on registry entries (e.g., `redact: ['context.userId', 'context.email']`) and apply them in `toJSON`, `logError`, and `problemDetailsFrom` to prevent PII leakage.
- Add **safe client message** fields (`userMessage` / `i18nKey`) separate from internal `message`, and allow Problem Details generation to choose safe text for clients.

### Observability and tracing
- Provide **OpenTelemetry helpers**:
  - `recordException(error, span)` that sets span status and attributes (code, severity, retryable, fingerprint).
  - **Logger correlation**: include trace/span IDs automatically when available, and add a hook to format fingerprints consistently across services.
- Extend metrics to **export via callbacks** (e.g., `onErrorRecorded(error, metrics)` or a `metricsAdapter`) so teams can send data to Prometheus/Otel.

### Retry execution utilities
- Add a **`runWithRetry` helper** that reads retry metadata from `KitiumError` or registry defaults, applies backoff, and surfaces a standardized `RetryOutcome` with metrics.
- Offer **decorators/wrappers** for dependency calls that automatically convert thrown errors to `KitiumError`, apply retry policy, and enrich context.

### Error governance tooling
- Ship a **CLI** (`kitium-errors lint|list|generate`) to validate registry files, check code uniqueness, and emit documentation/TypeScript definitions for downstream services.
- Support **registry persistence** (e.g., loading from JSON/YAML) so service teams can manage catalogs without code changes and publish them centrally.

### Framework integrations
- Export **middleware/factory helpers**: `createExpressErrorMiddleware`, `fastifyErrorHandler`, `graphqlFormatError`, each normalizing unknown errors, enriching context, logging, and returning Problem Details consistently.
- Provide **job runner adapters** (BullMQ/Temporal) that map operational errors to `KitiumError` with retry metadata respected by the scheduler.

### Developer experience
- Add **test utilities** (e.g., `expectKitiumError`, `resetErrorMetrics` already exists) plus fixtures for registry validation and snapshotting Problem Details.
- Publish **recipes and code mods** to migrate legacy error patterns to `KitiumError`, ensuring consistent adoption across repos.

## Proposed next steps

1. **Design RFC** documenting the extended error schema (versioning, lifecycle, redaction, safe messages) and expected registry file format.
2. **Implement redaction + safe messaging** in core serialization paths to unblock compliance.
3. **Ship Otel + metrics adapters** to align with observability standards.
4. **Add framework adapters** starting with Express/Fastify and a retry execution helper to demonstrate end-to-end consistency.
5. **Deliver CLI tooling** to govern registry evolution and generate documentation for product teams.
