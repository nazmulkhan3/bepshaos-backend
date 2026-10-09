# BebshaOS Backend — Production Deployment Guide (Hostinger VPS + Coolify)

> **IMPORTANT**: This guide is prepared for future deployment when the complete Web frontend and Android mobile clients are finalized. **DO NOT execute deployment or apply production migrations until the complete system is ready.**

---

## 1. Architecture Overview

- **Host Platform**: Hostinger VPS (Ubuntu 22.04 / 24.04 LTS).
- **Orchestration**: Coolify PaaS (Docker & Nixpacks container engine).
- **Backend API**: NestJS 12 running on Node.js 24 Alpine (`USER node`, `dumb-init`).
- **Database Engine**: Managed PostgreSQL (e.g. Neon Serverless Postgres or Coolify Managed Postgres).
- **Cache & Queue**: Redis 7 Alpine (dedicated container for BullMQ job queue and Redis caching).
- **Reverse Proxy**: Coolify Traefik reverse proxy handling automated Let's Encrypt SSL/TLS certificates and routing.

---

## 2. Production Environment Variable Checklist

Configure these variables inside the Coolify Application Environment Settings. **Never commit real values to version control.**

| Variable | Required | Description | Example / Safe Format |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | Yes | Node runtime mode | `production` |
| `PORT` | Yes | Internal container listening port | `3000` |
| `DATABASE_URL` | Yes | Managed PostgreSQL connection pooler URI | `postgresql://user:secret@ep-xxx-pooler.region.neon.tech/neondb?sslmode=require` |
| `REDIS_URL` | Yes | Redis connection string for BullMQ & cache | `redis://default:secret@redis-service:6379` |
| `CORS_ORIGINS` | Yes | Allowed domains for web frontend | `https://app.bebshaos.com,https://admin.bebshaos.com` |
| `JWT_ACCESS_SECRET` | Yes | Secret for short-lived access tokens (min 32 chars) | `gen_random_32_chars_base64_secret...` |
| `JWT_ACCESS_EXPIRES_IN` | Yes | Access token lifetime | `15m` |
| `JWT_REFRESH_SECRET` | Yes | Secret for long-lived refresh tokens (min 32 chars)| `gen_random_32_chars_base64_secret...` |
| `JWT_REFRESH_EXPIRES_IN`| Yes | Refresh token session validity | `7d` |
| `OTP_HASH_SECRET` | Yes | Secret for hashing email/SMS OTP codes | `gen_random_32_chars_base64_secret...` |
| `EMAIL_PROVIDER` | Yes | Mailer provider (`console` for dev, `smtp` in prod) | `smtp` |
| `SMTP_HOST` | Conditional | SMTP server address | `smtp.resend.com` or `smtp.sendgrid.net` |
| `SMTP_PORT` | Conditional | SMTP server port | `587` |
| `SMTP_USER` | Conditional | SMTP username / API key identity | `resend` |
| `SMTP_PASS` | Conditional | SMTP password or token | `re_123456789...` |
| `EMAIL_FROM` | Yes | Verified sender address | `no-reply@bebshaos.com` |
| `THROTTLE_TTL` | Yes | Global rate limiter window (ms) | `60000` |
| `THROTTLE_LIMIT` | Yes | Max requests per window | `100` |
| `PLATFORM_ADMIN_EMAILS`| Optional| Comma-separated list of platform superadmins | `admin@bebshaos.com` |

---

## 3. Database & Network Connectivity Requirements

### 3.1 PostgreSQL (Neon / Managed)
- Use the **Connection Pooler URL** (`-pooler` endpoint) for transaction pooling under high concurrent connections.
- Ensure `sslmode=require` is appended to `DATABASE_URL`.
- Neon Compute Lifecycle: Set minimum compute suspend timeout to avoid cold starts during background job processing.
- Connection limit: Allocate at least 20 connections for the NestJS API pool.

### 3.2 Redis / BullMQ
- Deploy Redis 7 in Coolify as a dedicated service attached to the same Docker network as the API.
- Eviction policy: Configure Redis with `maxmemory-policy noeviction` (required for BullMQ queue reliability).
- Persistent storage: Attach a named Docker volume (`redis_data:/data`) with AOF persistence enabled (`appendonly yes`).

---

## 4. Domain, HTTPS, CORS & Healthchecks

1. **Domain & DNS**:
   - Point your DNS A/AAAA records (e.g. `api.bebshaos.com`) to your Hostinger VPS IP address.
2. **SSL/TLS**:
   - In Coolify, enter `https://api.bebshaos.com` as the application FQDN.
   - Coolify Traefik will automatically provision and renew Let's Encrypt certificates.
3. **CORS Security**:
   - Restrict `CORS_ORIGINS` strictly to production domains (`https://app.bebshaos.com`).
   - Do NOT use wildcard `*` in production.
4. **Health Check Probes**:
   - **Liveness probe**: `GET /api/v1/health` (Port 3000, returns HTTP 200 `{ status: "ok" }`).
   - **Readiness probe**: `GET /api/v1/health/readiness` (Checks active PostgreSQL query and Redis ping).

---

## 5. Zero-Downtime Safe Migration Procedure

> [!CAUTION]
> Never execute `prisma db push`, `prisma migrate reset`, or `--accept-data-loss` in production.

When deploying schema updates:
1. **Pre-deployment Database Backup**:
   - Take a point-in-time snapshot of the database before deploying (Neon Branch or `pg_dump`).
2. **Run Migrations via CI/CD or Coolify One-Off Task**:
   ```bash
   pnpm prisma migrate deploy
   ```
   - Only execute `migrate deploy`; this safely applies pending `.sql` migration files in a transactional manner without deleting existing columns or data.
3. **Rollback Safety**:
   - All migrations must adhere to backward-compatible schema changes (expand/contract pattern).
   - If an unexpected error occurs during migration, investigate `_prisma_migrations` table and rollback to the pre-deployment snapshot.

---

## 6. Logging, Monitoring & Disaster Recovery

- **Structured Logging**:
  - The application logs all requests through `LoggingMiddleware` with correlation IDs (`x-request-id`).
  - Container stdout is captured by Docker and accessible via Coolify real-time log viewers.
- **Audit Logs**:
  - All administrative, tenant role, quota, subscription, and financial events are automatically recorded in the `AuditLog` table.
- **Disaster Recovery**:
  - Configure daily automated database backups with at least 14-day retention.
  - Test restoring a backup to a staging branch once a month.

---

## 7. Prerequisite Checklist: Steps Waiting on Web & Android Clients

Do not proceed with production deployment until the following items are complete:

- [ ] **Android Client Completion**:
  - Finalize Room SQLite offline database schema and WorkManager sync tasks.
  - Verify mobile sync payloads conform to `SyncUploadDto` and `SyncDownloadDto`.
- [ ] **Web Frontend Client Completion**:
  - Complete Next.js / Vite dashboard and auth token refresh interceptors.
  - Confirm CORS domain and authentication cookie/header behavior.
- [ ] **Billing Provider Credentials**:
  - Obtain production API keys and webhook signing secrets for bKash, SSLCommerz, or Stripe.
- [ ] **Final End-to-End User Acceptance Testing (UAT)**:
  - Validate full registration, multi-branch, POS sale, subscription upgrade, and offline sync replay in a staging environment.
