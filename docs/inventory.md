# Inventory Management

Phase 11 introduces a robust, multi-tenant, and concurrent inventory tracking system within BebshaOS. Stock is managed exclusively at the **Branch** level.

## Core Models

### 1. Inventory
The `Inventory` model tracks current stock and reserved stock per product at a specific branch.

- **Unique Constraint**: `organizationId` + `branchId` + `productId`.
- **Fields**: `quantity`, `reservedQuantity`, `updatedAt`, `createdAt`.
- **Quantity Type**: Prisma `Decimal(19,4)` maps to Postgres `DECIMAL`, resolving typical floating-point arithmetic errors for fractional metrics (kg, L, etc).

### 2. StockMovement (Immutable Ledger)
The `StockMovement` model serves as an immutable log for every change affecting an inventory record.

- **Types (`InventoryMovementType`)**: `STOCK_IN`, `STOCK_OUT`, `ADJUSTMENT`.
- **Fields**: `beforeQuantity`, `afterQuantity`, `delta`, `idempotencyKey`.

## Transactional Concurrency

Inventory levels must handle highly concurrent environments (e.g. offline synchronization blasts, massive POS checkouts). To solve race conditions, **Row-Level Locking** is implemented.

\`\`\`sql
SELECT id, quantity FROM "Inventory" WHERE id = $1 FOR UPDATE
\`\`\`

The query explicitly locks the specific inventory row being mutated. No other mutation can update the stock until the current Prisma `$transaction` commits or rolls back. 
Negative stock is rejected via Application Logic *while* the row is locked, guaranteeing a conflict exception instead of corrupted ledgers.

## Idempotency
To support unreliable network connections (like an offline Android App synchronizing batches), endpoints accept an `idempotencyKey`.

If the key exists on a `StockMovement` for the given `organizationId`, the API silently returns the previous successful result, guaranteeing exactly-once stock adjustments.

## Endpoints

1. **GET `/v1/inventory`**: List branch-scoped stock across products.
2. **GET `/v1/inventory/movements`**: History log of stock activities.
3. **GET `/v1/inventory/:id`**: Single product stock summary at a branch.
4. **POST `/v1/inventory/stock-in`**: Stock in operation (Increase).
5. **POST `/v1/inventory/stock-out`**: Stock out operation (Decrease). Requires adequate stock.
6. **POST `/v1/inventory/adjust`**: Forces the stock to `newQuantity`, dynamically determining if it's an `ADJUSTMENT_IN` or `ADJUSTMENT_OUT`.

## Role Based Access Control (RBAC)
Granular permissions are supported:
- `inventory:read`
- `inventory:stock-in`
- `inventory:stock-out`
- `inventory:adjust`
