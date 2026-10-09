# Phase 12 — Sales & POS Management Documentation

## Overview
The Sales & POS Management module is the commercial core of **BebshaOS**, handling sales transactions, point-of-sale checkout workflows, automatic stock deductions, cancellations, tenant isolation, and audit logging. It directly integrates with the **Phase 11 Inventory Management** system using PostgreSQL row-level locking for atomic, deadlock-free inventory mutations.

---

## 1. Data Models & Schema Architecture

### Sale Model
Represents an immutable commercial transaction within an organization and branch.

| Field | Type | Attributes | Description |
|---|---|---|---|
| `id` | `String` | `@id @default(uuid())` | Primary key |
| `organizationId` | `String` | Foreign Key | Multi-tenant organization scoping |
| `branchId` | `String` | Foreign Key | Branch where transaction took place |
| `customerId` | `String?` | Foreign Key (Nullable) | Optional customer (null for walk-in sales) |
| `saleNumber` | `String` | `@unique([organizationId, saleNumber])` | Organization-scoped human-readable number (`SALE-000001`) |
| `invoiceNumber` | `String?` | Optional | Synced invoice identifier |
| `subtotal` | `Decimal(19, 4)` | `@default(0)` | Gross sum before discounts and taxes |
| `discountAmount` | `Decimal(19, 4)` | `@default(0) @map("discount")` | Cumulative discount applied |
| `taxAmount` | `Decimal(19, 4)` | `@default(0) @map("tax")` | Cumulative tax applied |
| `totalAmount` | `Decimal(19, 4)` | `@default(0) @map("total")` | Net payable amount |
| `paidAmount` | `Decimal(19, 4)` | `@default(0)` | Amount collected |
| `status` | `SaleStatus` | `@default(COMPLETED)` | Lifecycle status: `COMPLETED` or `CANCELLED` |
| `note` | `String?` | Optional | Transaction remarks |
| `idempotencyKey` | `String?` | `@unique([organizationId, idempotencyKey])` | Client retry deduplication key |
| `requestHash` | `String?` | Optional | SHA-256 hash of payload for conflict detection |
| `createdBy` | `String?` | Foreign Key (`User`) | User who finalized the sale |
| `cancelledAt` | `DateTime?` | Optional | Timestamp when cancelled |
| `cancelledBy` | `String?` | Foreign Key (`User`) | User who cancelled the sale |
| `createdAt` | `DateTime` | `@default(now())` | Creation timestamp |
| `updatedAt` | `DateTime` | `@updatedAt` | Last modification timestamp |

### SaleItem Model
Records each line item sold, preserving historical commercial data regardless of future product master updates.

| Field | Type | Attributes | Description |
|---|---|---|---|
| `id` | `String` | `@id @default(uuid())` | Primary key |
| `saleId` | `String` | Foreign Key (`Sale`) | Parent sale reference |
| `productId` | `String` | Foreign Key (`Product`) | Product reference |
| `quantity` | `Decimal(19, 4)` | Mandatory | Quantity sold (supports fractional units) |
| `unitPrice` | `Decimal(19, 4)` | Mandatory | Effective selling price per unit |
| `discountAmount` | `Decimal(19, 4)` | `@default(0) @map("discount")` | Line discount amount |
| `taxAmount` | `Decimal(19, 4)` | `@default(0) @map("tax")` | Line tax amount |
| `lineTotal` | `Decimal(19, 4)` | Mandatory | Net line total `(qty * price) - discount + tax` |
| `createdAt` | `DateTime` | `@default(now())` | Creation timestamp |

**Constraint**: `@@unique([saleId, productId])` prevents duplicate products within the same sale.

---

## 2. Sale Lifecycle & Status

For Phase 12, sales operate on a two-state deterministic lifecycle:
- **`COMPLETED`**: Finalized transaction. Immediately upon creation, stock is deducted atomically.
- **`CANCELLED`**: Cancelled sale. Compensating inventory movements are created and stock is restored atomically.

Drafts and arbitrary PATCH mutations are prohibited to maintain commercial integrity. Corrections must be handled through full cancellation.

---

## 3. Human-Readable Sale Numbering

Sale numbers follow the format `SALE-000001`, `SALE-000002`, scoped per organization:
- Generated inside the transaction by inspecting `orderBy: { saleNumber: 'desc' }`.
- Concurrency protection: If two concurrent transactions attempt to commit with the same sale number, the unique constraint `@@unique([organizationId, saleNumber])` raises `P2002`. The service catches this and retries with randomized backoff (up to 10 attempts).

---

## 4. Pricing & Money Calculation Rules

1. **Precision**: All financial calculations are executed using `Prisma.Decimal` (PostgreSQL `NUMERIC(19, 4)`). JavaScript IEEE 754 floating-point numbers are never used for persisted monetary values.
2. **Deterministic Formula**:
   - For each item $i$:
     $$\text{lineSubtotal}_i = \text{quantity}_i \times \text{unitPrice}_i$$
     $$\text{lineTotal}_i = \text{lineSubtotal}_i - \text{discountAmount}_i + \text{taxAmount}_i$$
   - For the whole sale:
     $$\text{subtotal} = \sum \text{lineSubtotal}_i$$
     $$\text{totalDiscount} = \sum \text{itemDiscount}_i + \text{saleDiscount}$$
     $$\text{totalTax} = \sum \text{itemTax}_i + \text{saleTax}$$
     $$\text{totalAmount} = \text{subtotal} - \text{totalDiscount} + \text{totalTax}$$
3. **Canonical vs Provided Price**: If `unitPrice` is omitted in the request, the system automatically uses the product's canonical `Product.sellingPrice`.

---

## 5. Phase 11 Inventory Integration & Concurrency Protection

### Deterministic Row-Level Locking
To completely eliminate PostgreSQL deadlocks during multi-product sales across concurrent checkout counters:
1. Product IDs are sorted **lexicographically** (`a.productId.localeCompare(b.productId)`).
2. For each product in sorted order, the inventory row is locked exclusively:
   ```sql
   SELECT id, quantity FROM "Inventory" WHERE id = $1 FOR UPDATE;
   ```
3. Stock sufficiency is verified:
   - If `currentQty < requestedQty`, the transaction immediately aborts with `409 ConflictException`.
   - No stock is deducted, no sale is created, and no movements or audit logs are generated.
4. Stock is deducted and an immutable `InventoryMovement` record is created:
   - `movementType`: `STOCK_OUT`
   - `referenceType`: `'SALE'`
   - `referenceId`: `sale.id`
   - `quantity`: `item.quantity`
   - `beforeQuantity` and `afterQuantity` tracked accurately.

---

## 6. Sale Cancellation Workflow

Endpoint: `POST /api/v1/organizations/:organizationId/sales/:saleId/cancel`

1. Verifies that the sale belongs to the organization and is currently `COMPLETED`.
2. Sorts sale item product IDs lexicographically and locks inventory rows with `FOR UPDATE`.
3. Restores stock: `quantity = quantity + item.quantity`.
4. Creates compensating `InventoryMovement`:
   - `movementType`: `STOCK_IN`
   - `referenceType`: `'SALE_CANCEL'`
   - `referenceId`: `sale.id`
   - `note`: Cancellation reason
5. Updates `Sale` status to `CANCELLED`, records `cancelledAt` and `cancelledBy`.
6. Creates `AuditLog` with action `SALE_CANCELLED`.
7. Entire operation is wrapped in **ONE atomic transaction**.

---

## 7. Idempotency Architecture

1. **Request Deduplication**: Clients can provide an `idempotencyKey`. The unique constraint `@@unique([organizationId, idempotencyKey])` enforces organization-scoped uniqueness in PostgreSQL.
2. **Payload Conflict Detection**: A SHA-256 hash of the normalized payload is computed and stored.
   - **Identical retry**: Returns the existing sale data immediately without double deduction.
   - **Mismatched payload**: Throws `409 ConflictException` ("Idempotency key has already been used with a different request payload").

---

## 8. Role-Based Access Control (RBAC)

The module enforces granular permissions via `TenantGuard` and `PermissionGuard`:
- `sale:read`: View sales listing and detailed receipt information.
- `sale:create`: Process new sales and deduct stock.
- `sale:cancel`: Cancel completed sales and restore stock.

System `OWNER` retains all permissions. `STAFF` by default can create and read, but cannot cancel.

---

## 9. Audit Logging

Every state transition produces structured `AuditLog` entries:
- `SALE_CREATED`: Captures `saleNumber`, `branchId`, `customerId`, `totalAmount`, and `itemCount`.
- `SALE_CANCELLED`: Captures `saleNumber`, `reason`, and cancellation actor.

---

## 10. API Endpoints

### 1. Create Sale
- **Route**: `POST /api/v1/organizations/:organizationId/sales`
- **Permission**: `sale:create`
- **Payload**:
  ```json
  {
    "branchId": "uuid",
    "customerId": "uuid (optional)",
    "items": [
      {
        "productId": "uuid",
        "quantity": 2,
        "unitPrice": 150.0,
        "discountAmount": 5.0,
        "taxAmount": 2.5
      }
    ],
    "discountAmount": 10.0,
    "taxAmount": 5.0,
    "note": "POS Counter 1",
    "idempotencyKey": "pos-txn-12345"
  }
  ```
- **Response**: `201 Created`

### 2. List Sales
- **Route**: `GET /api/v1/organizations/:organizationId/sales`
- **Permission**: `sale:read`
- **Query Params**: `page`, `limit`, `search`, `branchId`, `customerId`, `status`, `dateFrom`, `dateTo`, `sortBy`, `sortOrder`
- **Response**: `200 OK` (with paginated `data` and `meta`)

### 3. Get Sale Details
- **Route**: `GET /api/v1/organizations/:organizationId/sales/:saleId`
- **Permission**: `sale:read`
- **Response**: `200 OK`

### 4. Cancel Sale
- **Route**: `POST /api/v1/organizations/:organizationId/sales/:saleId/cancel`
- **Permission**: `sale:cancel`
- **Payload**:
  ```json
  {
    "reason": "Customer returned unopened merchandise",
    "idempotencyKey": "cancel-txn-12345"
  }
  ```
- **Response**: `200 OK`
