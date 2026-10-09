# Phase 15 — Digital Khata / Double-Entry Ledger

## Overview

Phase 15 implements a production-grade **double-entry accounting ledger** as the financial source of truth for BebshaOS. Every financial business event (Sale, Purchase, Payment) automatically generates an immutable, balanced journal entry that feeds the Digital Khata (customer/supplier ledgers) and account balance calculations.

---

## Account Architecture

### Chart of Accounts

Every organization receives a minimum set of **system accounts** provisioned automatically at organization creation:

| Code | Name               | Type      | Category            |
|------|--------------------|-----------|---------------------|
| 1000 | Cash               | ASSET     | CASH                |
| 1010 | Bank               | ASSET     | BANK                |
| 1100 | Accounts Receivable| ASSET     | ACCOUNTS_RECEIVABLE |
| 1200 | Inventory          | ASSET     | INVENTORY           |
| 2000 | Accounts Payable   | LIABILITY | ACCOUNTS_PAYABLE    |
| 3000 | Owner Equity       | EQUITY    | OWNER_EQUITY        |
| 4000 | Sales Revenue      | REVENUE   | SALES_REVENUE       |
| 5000 | General Expense    | EXPENSE   | GENERAL_EXPENSE     |

**System accounts** (`isSystem = true`) cannot be deleted or deactivated.

### Account Types

- `ASSET` — resources owned by the org (Cash, AR, Inventory)
- `LIABILITY` — obligations (Accounts Payable)
- `EQUITY` — owner's stake
- `REVENUE` — income (Sales Revenue)
- `EXPENSE` — costs

### Account Categories

Categories provide semantic grouping used for automatic account resolution during journal posting.

### Account Hierarchy

Accounts support optional parent-child relationships via `parentId`. Restrictions:
- Self-parenting prohibited
- Circular hierarchy prohibited
- Cross-organization parents prohibited

---

## Journal Entries

### JournalEntry Fields

| Field           | Description                                          |
|-----------------|------------------------------------------------------|
| `entryNumber`   | Org-scoped sequential number: `JE-000001`           |
| `entryDate`     | Date/time of posting                                 |
| `sourceType`    | `SALE`, `PURCHASE`, `CUSTOMER_PAYMENT`, `SUPPLIER_PAYMENT`, `MANUAL` |
| `sourceId`      | ID of the source business record                     |
| `status`        | `POSTED` or `REVERSED`                               |
| `idempotencyKey`| Client-provided key for idempotent creation          |
| `reversedById`  | Points to the reversal entry (if reversed)           |
| `reversalOfId`  | Points to the original entry (if this is a reversal) |

### Journal Entry Status

- `POSTED` — immutable, contributes to balances
- `REVERSED` — original entry is logically cancelled; its reversal is POSTED

---

## Debit / Credit Rules

| Account Type    | Debit Effect          | Credit Effect         |
|-----------------|----------------------|-----------------------|
| ASSET           | Increases balance     | Decreases balance     |
| LIABILITY       | Decreases balance     | Increases balance     |
| EQUITY          | Decreases balance     | Increases balance     |
| REVENUE         | Decreases balance     | Increases balance     |
| EXPENSE         | Increases balance     | Decreases balance     |

### Line Rules

Each `JournalEntryLine` must satisfy:
- `debit >= 0`
- `credit >= 0`
- Either `debit > 0` OR `credit > 0` (never both on same line)
- `SUM(debit) == SUM(credit)` across the entire entry

---

## Business Event → Journal Mapping

### Sale Accounting

When a Sale is COMPLETED:

**Registered Customer (customerId set):**
```
DR  Accounts Receivable    (totalAmount)
CR  Sales Revenue          (totalAmount)
```

**Walk-in Sale (no customer):**
```
DR  Cash                   (totalAmount)
CR  Sales Revenue          (totalAmount)
```

### Purchase Accounting

When a Purchase is COMPLETED:
```
DR  Inventory              (total)
CR  Accounts Payable       (total)
```

### Customer Payment Accounting

When a RECEIVED payment is created:
```
DR  Cash / Bank            (amount)   ← based on PaymentMethod
CR  Accounts Receivable    (amount)
```

PaymentMethod mapping:
- `CASH` → Cash (1000)
- `BANK` → Bank (1010)
- `BKASH` → Bank (1010)
- `NAGAD` → Bank (1010)
- `CARD` → Bank (1010)
- `OTHER` → Cash (1000)

### Supplier Payment Accounting

When a PAID payment is created:
```
DR  Accounts Payable       (amount)
CR  Cash / Bank            (amount)   ← based on PaymentMethod
```

---

## Reversal Architecture

Corrections are performed through **reversal entries**, never by editing or deleting posted journals.

A reversal entry:
- Swaps debits and credits of the original entry line-for-line
- Is posted as a new `POSTED` journal entry
- Sets `reversalOfId` pointing to the original
- Marks the original `status = REVERSED` and sets `reversedById`

### Sale Cancellation Reversal

Original:
```
DR  AR / Cash        1000
CR  Sales Revenue    1000
```
Reversal:
```
DR  Sales Revenue    1000
CR  AR / Cash        1000
```

### Purchase Cancellation Reversal

Original:
```
DR  Inventory        500
CR  AP               500
```
Reversal:
```
DR  AP               500
CR  Inventory        500
```

### Payment Void Reversal

Original:
```
DR  Cash             200
CR  AR               200
```
Reversal:
```
DR  AR               200
CR  Cash             200
```

### Reversal Protection

- A journal entry cannot be reversed more than once
- Duplicate reversal requests are idempotent (return existing reversal)

---

## Customer Khata (Digital Khata)

Endpoint: `GET /v1/organizations/:orgId/customers/:customerId/khata`

Returns a complete customer financial statement derived from `JournalEntryLine` records tagged with `customerId`.

Balance semantics (AR is ASSET):
- **Debit** increases receivable (customer owes more)
- **Credit** decreases receivable (customer paid)

Response includes:
- `openingBalance` — from Customer.openingBalance
- `transactions` — all posted AR lines for this customer
- `outstanding` = `openingBalance + totalDebits - totalCredits`
- `runningBalance` — per-transaction running total

---

## Supplier Khata

Endpoint: `GET /v1/organizations/:orgId/suppliers/:supplierId/khata`

Balance semantics (AP is LIABILITY):
- **Credit** increases payable (we owe supplier more)
- **Debit** decreases payable (we paid supplier)

`outstanding` = `totalCredits - totalDebits`

---

## Account Balance

Endpoint: `GET /v1/organizations/:orgId/ledger/accounts/:accountId/balance`

Calculated from **POSTED** journal lines only. REVERSED entries do not have their original effect cancelled by exclusion — instead the reversal entry's lines produce the offsetting amounts.

Balance formula:
- `ASSET` / `EXPENSE` accounts: `balance = totalDebit - totalCredit`
- `LIABILITY` / `EQUITY` / `REVENUE` accounts: `balance = totalCredit - totalDebit`

---

## Running Balance

Account ledger history (`GET /v1/organizations/:orgId/ledger/accounts/:accountId/ledger`) returns a chronological list of transactions with a computed `runningBalance` per line using Decimal arithmetic.

---

## Immutability

Once `JournalEntry.status = POSTED`:
- Amount cannot be changed
- Account assignments cannot be changed
- Entry cannot be deleted
- Lines cannot be modified

**Correction requires creating a reversal entry.**

---

## Idempotency

### Source Event Uniqueness
For non-MANUAL source types, a unique database constraint on `(organizationId, sourceType, sourceId)` prevents duplicate journal entries for the same business event.

### Manual Entry Idempotency
Manual journal entries support an `idempotencyKey`. Same key + same payload → returns existing entry. Same key + different payload → `409 Conflict`.

---

## Concurrency

### Journal Number Generation
Entry numbers are generated inside a transaction with bounded retry on `P2002` collisions and random jitter, ensuring unique sequential numbers under concurrent load.

### Locking
The `postJournal` method is designed to operate within a caller-provided transaction. Source-uniqueness conflicts resolve via idempotent returns.

---

## Tenant Isolation

- Every ledger query is scoped by `organizationId`
- `organizationId` is never trusted from request body — it comes from the TenantGuard/route params validated against the user's membership
- Cross-organization access returns 403 or 404

---

## Branch Isolation

Where `branchId` is provided, branch ownership is verified against the current organization. Cross-tenant branch references are rejected.

---

## RBAC Permissions

| Permission              | Grants Access To                              |
|-------------------------|-----------------------------------------------|
| `ledger:read`           | Account balances, ledger history, khata views |
| `ledger:account-read`   | List and view accounts                        |
| `ledger:account-create` | Create new custom accounts                    |
| `ledger:account-update` | Update account name/status                    |
| `ledger:journal-read`   | List and view journal entries                 |
| `ledger:journal-create` | Create manual journal entries                 |
| `ledger:reverse`        | Reverse posted journal entries                |

System role assignments:
- `OWNER` / `ADMIN` → all ledger permissions
- `MANAGER` → `ledger:read`, `ledger:account-read`, `ledger:journal-read`
- `ACCOUNTANT` → all ledger permissions (full accounting access)
- `STAFF` → no ledger permissions

---

## Audit Logs

The following events are recorded in `AuditLog` within the same transaction:

| Event                    | Trigger                         |
|-------------------------|---------------------------------|
| `JOURNAL_ENTRY_CREATED`  | Any journal entry posted        |
| `JOURNAL_ENTRY_REVERSED` | Any journal entry reversed      |
| `ACCOUNT_CREATED`        | New account created             |
| `ACCOUNT_UPDATED`        | Account modified                |

---

## Decimal Precision

All monetary fields use `Decimal(19, 4)` in the database. All arithmetic uses `decimal.js` (`Decimal` class). No native JavaScript `Number` arithmetic is used for financial calculations.

---

## API Reference

### Accounts
```
GET    /v1/organizations/:id/ledger/accounts
POST   /v1/organizations/:id/ledger/accounts
GET    /v1/organizations/:id/ledger/accounts/:accountId
PATCH  /v1/organizations/:id/ledger/accounts/:accountId
GET    /v1/organizations/:id/ledger/accounts/:accountId/balance
GET    /v1/organizations/:id/ledger/accounts/:accountId/ledger
```

### Journal Entries
```
GET    /v1/organizations/:id/journal-entries
POST   /v1/organizations/:id/journal-entries
GET    /v1/organizations/:id/journal-entries/:entryId
POST   /v1/organizations/:id/journal-entries/:entryId/reverse
```

### Digital Khata
```
GET    /v1/organizations/:id/customers/:customerId/khata
GET    /v1/organizations/:id/suppliers/:supplierId/khata
```

---

## Migration Safety

The Phase 15 schema is applied via a dedicated Prisma migration:
`20260920_phase15_double_entry_ledger`

Migration safety checklist:
- ✅ No `prisma migrate reset` or `--accept-data-loss` used
- ✅ Phase 01–14 migration history preserved
- ✅ Database schema validated with `prisma validate`
- ✅ No destructive DDL applied to existing tables

---

## Financial Safety Rules

1. **Never silently fix an imbalance** — if `SUM(debit) ≠ SUM(credit)`, the transaction fails with `400 Bad Request`
2. **Never auto-add balancing lines** — the imbalance is always an error
3. **Never overwrite historical journal amounts**
4. **Balances are always derived from ledger lines**, never from operational record fields (`Sale.totalAmount`, `Payment.amount`, etc.)
