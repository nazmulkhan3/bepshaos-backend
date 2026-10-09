# Expense Management Module (Phase 16)

The Expense Management module handles direct operational expenses for an organization within BebshaOS. It is deeply integrated with the Phase 15 Double-Entry Ledger System.

## Architecture

1. **ExpenseCategory Model**
   - Belongs to an `Organization`.
   - Linked to a specific `Account` (type: `EXPENSE`) in the ledger.
   - Example categories: Rent, Utilities, Office Supplies, Software Subscriptions.

2. **Expense Model**
   - Belongs to an `Organization` (and optionally a `Branch`).
   - Linked to an `ExpenseCategory`.
   - Paid via a `paymentAccount` (type: `ASSET`, e.g., Cash or Bank).
   - `idempotencyKey` ensures that an expense is not recorded twice by accident.

3. **Ledger Integration**
   - The `ExpensesService` directly calls the `LedgerService` to record the journal entry for the expense.
   - Creating an expense results in a balanced journal entry:
     - **Debit:** Expense Account (from ExpenseCategory)
     - **Credit:** Asset Account (from paymentAccountId)

## Endpoints

### Categories
- `POST /expenses/categories` - Create a new expense category.
- `GET /expenses/categories` - List all expense categories for the organization.
- `GET /expenses/categories/:id` - Get details of a specific category.
- `PATCH /expenses/categories/:id` - Update category details (name, description, active status).

### Expenses
- `POST /expenses` - Record a new expense.
  - Requires: `categoryId`, `amount`, `paymentMethod`, `paymentAccountId`, `idempotencyKey`.
  - Action: Creates the expense record and posts the corresponding ledger journal.
- `GET /expenses` - List expenses (with pagination and filtering).
- `GET /expenses/:id` - View details of a specific expense.
- `POST /expenses/:id/cancel` - Cancel an expense.
  - Action: Marks the expense as cancelled and uses `LedgerService` to reverse the corresponding journal entry.

## RBAC Permissions
- `expense-category:create`, `expense-category:read`, `expense-category:update`
- `expense:create`, `expense:read`, `expense:cancel`
