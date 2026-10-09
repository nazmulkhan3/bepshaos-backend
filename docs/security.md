# Security & Architecture Documentation

## Environment Secrets
- Secrets are managed via `class-validator` in `src/config/env.validation.ts`.
- The application fails fast on startup if required variables are missing.
- See `.env.example` for required variables.

## CORS Configuration
- Configured dynamically via `CORS_ORIGINS` environment variable.
- Comma-separated list for multiple origins. Defaults to `*` if not set (for development only).

## Rate Limiting
- Foundation built using `@nestjs/throttler`.
- Global limit is controlled via `THROTTLE_TTL` and `THROTTLE_LIMIT`.
- Future phases will add specific throttlers (e.g. for authentication, OTP).

## Validation & Error Handling
- Global `ValidationPipe` ensures strict payload validation (`whitelist: true`, `forbidNonWhitelisted: true`).
- `GlobalExceptionFilter` guarantees a consistent error structure for API clients.
- Internal database error codes (Prisma codes) are safely mapped to HTTP statuses without leaking table names or DB specifics.

## Logging Redaction & Request IDs
- Every request generates or propagates an `X-Request-ID`.
- `AppLogger` intercepts objects and strings, redacting fields like `password`, `token`, `secret`, `jwt` before outputting to the console.

## Architecture Outlook
- **Tenant Isolation**: (To be implemented in Phase 05).
- **Financial Transactions**: Prepared for safe execution using Prisma's `$transaction` logic as documented in `DatabaseService`.

## Graceful Shutdown
- Application is configured to capture termination signals (e.g., `SIGTERM`) and gracefully close HTTP connections, Redis clients, and background worker queues.
