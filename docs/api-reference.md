# BebshaOS Backend — API Reference & Architecture Specification

> **Version**: 1.0.0  
> **Base URL**: `/api/v1`  
> **Interactive Swagger UI**: `/api/docs`  
> **Target Consumers**: Web Management Dashboard (Next.js / React) & Mobile Android POS (Kotlin Room + WorkManager)

---

## 1. Authentication & Security Architecture

### 1.1 Authentication & Tokens
- **Strategy**: Stateless JWT with short-lived access tokens and stateful database-tracked refresh sessions.
- **Headers**:
  ```http
  Authorization: Bearer <JWT_ACCESS_TOKEN>
  ```
- **Session Revocation**: Logging out revokes the specific `Session` row or invalidates all sessions for the user (`/auth/logout`, `/auth/logout-all`).

### 1.2 Tenant Isolation & IDOR Protection ([TenantGuard](file:///home/nazmul-khan/project/project/bepshaos/bepshaos-backend/src/common/guards/tenant.guard.ts))
- All organization endpoints are scoped under: `/api/v1/organizations/:organizationId/*`.
- **Header**: `x-organization-id: <ORGANIZATION_UUID>`
- **IDOR Check**: If both URL path param `:organizationId` and header `x-organization-id` are present, they **must match** exactly; otherwise a `400 Bad Request` is rejected.
- **Membership & Status Verification**: Verifies `userId` holds an `ACTIVE` membership in the organization and the organization itself is `ACTIVE`. Injects `req.organizationContext`.

### 1.3 Role-Based Access Control ([PermissionGuard](file:///home/nazmul-khan/project/project/bepshaos/bepshaos-backend/src/common/guards/permission.guard.ts))
- Every endpoint is protected with granular permissions (e.g. `@RequirePermissions('sale:create')`).
- Organization `OWNER` role holds automatic full permissions. Custom roles inherit explicit permission rows.

### 1.4 Platform Super-Admin ([PlatformAdminGuard](file:///home/nazmul-khan/project/project/bepshaos/bepshaos-backend/src/common/guards/platform-admin.guard.ts))
- System-wide administration routes reside under `/api/v1/admin/*`.
- Strictly verified against server-side `PLATFORM_ADMIN_EMAILS` or `PLATFORM_ADMIN_USER_IDS`. Tenant roles cannot grant platform access.

---

## 2. API Endpoints Catalog

### 2.1 Auth Module (`/api/v1/auth`)
| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/auth/register` | Register new user account | Public |
| `POST` | `/auth/verify-email-otp` | Verify email with OTP | Public |
| `POST` | `/auth/login` | Email/password login, returns access & refresh tokens | Public |
| `POST` | `/auth/refresh` | Rotate refresh token and get new access token | Public |
| `POST` | `/auth/logout` | Invalidate current session | Bearer |
| `POST` | `/auth/forgot-password` | Request password reset OTP | Public |
| `POST` | `/auth/reset-password` | Set new password with OTP | Public |

### 2.2 Organization & Membership (`/api/v1/organizations`)
| Method | Endpoint | Description | Permissions |
| :--- | :--- | :--- | :--- |
| `POST` | `/organizations` | Create new organization (provisions owner, ledger, Free plan)| Bearer |
| `GET` | `/organizations/my` | List organizations user belongs to | Bearer |
| `GET` | `/organizations/:organizationId` | Get organization details | `organization:read` |
| `PATCH`| `/organizations/:organizationId` | Update organization details | `organization:update` |
| `GET` | `/organizations/:organizationId/members` | List organization staff/members | `organization:read` |
| `POST` | `/organizations/:organizationId/members` | Invite/add member (enforces STAFF quota) | `member:create` |
| `PATCH`| `/organizations/:organizationId/members/:userId/role` | Assign role to member | `member:update` |

### 2.3 Business Domains (Tenant Scoped)
All routes prefixed with `/api/v1/organizations/:organizationId`:

#### Branches (`/branches`)
- `POST /branches` — Create branch (enforces `BRANCH` plan quota)
- `GET /branches` — List active branches
- `GET /branches/:branchId` — Branch details
- `PATCH /branches/:branchId` — Update branch

#### Customers & Suppliers (`/customers`, `/suppliers`)
- `POST /customers` — Create customer (auto CUS-000001 code)
- `GET /customers` — Search and paginated list
- `GET /customers/:customerId` — Customer details & addresses
- `PATCH /customers/:customerId` — Update customer
- `DELETE /customers/:customerId` — Soft delete / archive
- Matching endpoints available for `/suppliers`.

#### Products & Categories (`/products`, `/categories`)
- `POST /products` — Create product (enforces `PRODUCT` quota under row lock)
- `GET /products` — Search, filter by category/stock, pagination
- `GET /products/:productId` — Product details
- `PATCH /products/:productId` — Update product details
- `POST /categories` — Create hierarchical category

#### Inventory (`/inventory`)
- `GET /inventory` — Query current stock levels per branch and product
- `POST /inventory/stock-in` — Add stock with `InventoryMovement`
- `POST /inventory/stock-out` — Deduct stock with validation
- `POST /inventory/adjust` — Reconcile physical count differences

#### Sales POS (`/sales`)
- `POST /sales` — Create sale (atomic transaction: stock verification & deduction, SaaS transaction quota enforcement, double-entry ledger posting, audit log, idempotency key replay protection)
- `GET /sales` — Filter sales by branch, customer, status, date
- `GET /sales/:saleId` — Sale details with line items
- `POST /sales/:saleId/cancel` — Cancel sale and restock inventory

#### Double-Entry Ledger & Payments (`/ledger`, `/payments`)
- `GET /ledger/accounts` — Chart of Accounts (Cash, Bank, AR, AP, Revenue, Expenses)
- `GET /ledger/journal-entries` — Double-entry audit trail
- `POST /payments` — Record payment allocation (inbound/outbound) with idempotency

### 2.4 SaaS Subscriptions & Billing (`/api/v1/plans`, `/api/v1/organizations/:id/subscription`)
| Method | Endpoint | Description | Auth |
| :--- | :--- | :--- | :--- |
| `GET` | `/plans` | Discover public subscription tiers (Free, Starter, Pro) | Public |
| `GET` | `/plans/:code` | Plan pricing and quota specifications | Public |
| `GET` | `/organizations/:id/subscription` | Current subscription status & period dates | Bearer + Tenant |
| `GET` | `/organizations/:id/subscription/usage` | Real-time usage vs quotas (products, staff, etc.) | Bearer + Tenant |
| `POST` | `/organizations/:id/subscription/trial` | Activate 14-day premium trial | `subscription:update` |
| `POST` | `/organizations/:id/subscription/change-plan` | Switch subscription plan | `subscription:update` |
| `POST` | `/organizations/:id/subscription/cancel` | Cancel at period end or immediately | `subscription:update` |
| `POST` | `/subscriptions/webhooks/:provider` | Payment gateway webhook ingestion & replay protection | Public + Signature |

### 2.5 Offline Sync API for Android (`/api/v1/organizations/:organizationId/sync`)
- `POST /sync/upload`:
  - Uploads a batch of offline mutations captured by mobile WorkManager.
  - Supports `CUSTOMER`, `CATEGORY`, `PRODUCT`, `SALE`, `PAYMENT`, `INVENTORY_ADJUSTMENT`.
  - Every operation validated and authorized server-side.
  - Uses `clientId` and `operationId` for bulletproof duplicate replay protection.
  - Returns structured results with explicit conflict reasons (`SERVER_RECORD_NEWER`, `CROSS_TENANT_COLLISION`, `INSUFFICIENT_STOCK`).
- `GET /sync/download`:
  - Incremental download with `since` cursor and `limit`.
  - Returns updated domain records and computes reliable `nextCursor`.

### 2.6 Platform Admin (`/api/v1/admin`)
- `GET /admin/organizations` — Cross-tenant organization metrics and audit stats.
- `GET /admin/organizations/:id` — Full details.
- `PATCH /admin/organizations/:id/subscription/override` — Platform admin plan override.
- `GET /admin/plans` & `POST /admin/plans` — Manage platform subscription tiers.
- `GET /admin/audit-logs` — Query platform-wide audit log trail.

### 2.7 System Health (`/api/v1/health`)
- `GET /health` — Liveness probe (HTTP 200 `{ status: "ok" }`).
- `GET /health/readiness` — Readiness probe verifying active PostgreSQL connection and Redis ping.

---

## 3. Standard Response & Error Envelope

All responses (except `/health` and webhook acks) follow a predictable envelope via [ResponseInterceptor](file:///home/nazmul-khan/project/project/bepshaos-backend/src/common/interceptors/response.interceptor.ts):

### Success Response
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "total": 100,
    "page": 1,
    "limit": 20,
    "totalPages": 5
  }
}
```

### Error Response
Handled by [GlobalExceptionFilter](file:///home/nazmul-khan/project/project/bepshaos/bepshaos-backend/src/common/filters/global-exception.filter.ts):
```json
{
  "statusCode": 409,
  "timestamp": "2026-10-09T17:00:00.000Z",
  "path": "/api/v1/organizations/org-uuid/sales",
  "message": "Insufficient stock for product Widget A. Current: 2, Requested: 5",
  "error": "Conflict"
}
```
