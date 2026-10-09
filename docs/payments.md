# Payment Management - Phase 14

## Payment Architecture
BebshaOS Payment Management provides a reliable payment layer between business parties (Customer/Supplier) and their related transactions (Sales/Purchases).

A **Payment** represents money received or paid.
A **PaymentAllocation** determines which business transaction that money settles.

Payments have a strict direction:
- `RECEIVED`: Business receives money from a customer (allocated to Sales).
- `PAID`: Business pays money to a supplier (allocated to Purchases).

Payment Methods:
- `CASH`, `BANK`, `BKASH`, `NAGAD`, `CARD`, `OTHER`

## Customer & Supplier Payments
- **Customer Payment**: `direction = RECEIVED`, `customerId = required`, `supplierId = null`. Allocations must target `Sale`.
- **Supplier Payment**: `direction = PAID`, `supplierId = required`, `customerId = null`. Allocations must target `Purchase`.
- Cross-party allocations or cross-tenant payments are strictly rejected.

## Payment Allocation
- A single Payment may allocate across multiple transactions of the same direction and party.
- Allocations must strictly reference a single transaction (`saleId` OR `purchaseId`).
- `SUM(allocation.amount)` MUST exactly equal `payment.amount`.

### Outstanding Calculation
For any transaction (Sale or Purchase), the outstanding amount is calculated dynamically:
`outstanding = totalAmount - SUM(allocations where payment is COMPLETED)`
Overpayment is strictly prevented. Allocation amount cannot exceed outstanding amount.

## Idempotency & Concurrency
- Payment creation leverages `idempotencyKey` and `requestHash` to prevent duplicate submissions.
- Concurrent payment allocations against the same transaction lock the target Sale/Purchase rows (`SELECT ... FOR UPDATE`).
- Multiple allocations within a single request are ordered lexicographically by target ID before locking to prevent deadlocks.
- Payment numbers (`PAY-00000X`) are generated safely using bounded retries to handle unique constraint violations.

## Void Behavior
Payments can be VOIDED to effectively reverse them without hard-deleting the record:
- Changes status from `COMPLETED` to `VOIDED`.
- Allocations attached to a `VOIDED` payment no longer count toward a transaction's outstanding amount.
- Does NOT mutate `Sale.total` or `Purchase.total`.
- Voiding is atomic, locking the Payment and affected transaction rows to ensure consistency.

## RBAC & Audit Logs
- Granular permissions: `payment:read`, `payment:create`, `payment:void`.
- System Roles map these appropriately (e.g., STAFF can create, ACCOUNTANT can void).
- Audit events `PAYMENT_CREATED` and `PAYMENT_VOIDED` are logged synchronously within the same transaction.

## API Endpoints
- `POST /v1/organizations/:organizationId/payments` (Create)
- `GET /v1/organizations/:organizationId/payments` (List/Query)
- `GET /v1/organizations/:organizationId/payments/:id` (Detail)
- `POST /v1/organizations/:organizationId/payments/:id/void` (Void)

## Out-of-scope Ledger Behavior
Phase 14 DOES NOT implement accounting Ledger entries (e.g. Accounts Receivable/Payable, Chart of Accounts, Journal entries). 
Payment Management preserves an immutable financial history so that the Digital Khata/Ledger (Phase 15) can consume payment lifecycle events and derive accounting entries later. Payments and allocations are never deleted.
