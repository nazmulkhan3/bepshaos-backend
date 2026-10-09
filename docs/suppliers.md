# Supplier Management

## Architecture

The Supplier module is built as the foundation for the upcoming Purchases, Payables, and Ledger systems. It currently strictly focuses on master data for suppliers and their addresses.

```text
Organization
    ↓
Suppliers (1 to Many)
    ↓
SupplierAddresses (1 to Many)
```

## Tenant Isolation

All queries and operations **must** enforce the `organizationId`. A `Supplier` belongs to one specific `Organization`. There is cross-tenant IDOR protection via `TenantGuard` and service-level checks:

```typescript
// Example from SupplierService
const supplier = await this.prisma.supplier.findFirst({
  where: { id: supplierId, organizationId },
});
```

## Supplier Code Generation

Like the Customer module, the Supplier module implements a safe concurrent strategy for sequence code generation (`SUP-00000X`). It uses a combination of:
- A database-level unique constraint: `@@unique([organizationId, supplierCode])`
- A transactional create process with retry logic handling Prisma `P2002` (Unique Constraint Violation).

## Lifecycle (Status)

Suppliers have an explicit lifecycle using the `SupplierStatus` enum:
- `ACTIVE`
- `INACTIVE`
- `ARCHIVED`

Archiving acts as a soft-delete, ensuring that future purchase history will never be cascade-deleted.

## Contact & Financial Information

- Contact information such as `email`, `phone`, `alternatePhone`, `website`, and `taxNumber` are supported.
- **Financial Boundaries:** We keep only an `openingBalance`. Running balances like `currentBalance` or `totalPayable` are avoided in this phase, as they will be managed by future financial/transaction modules.

## Supplier Addresses

Suppliers can have multiple addresses via the `SupplierAddress` table. 
- Addresses include a `isDefault` flag. 
- The module ensures that a supplier has at most one default address. Setting a new default address transactionally unsets the previous one.

## RBAC Permissions

The following permissions control access:
- `supplier:read`
- `supplier:create`
- `supplier:update`
- `supplier:archive`

These are seeded to `MANAGER` and selectively to `ACCOUNTANT` roles.

## API Endpoints

### Suppliers

- `GET /api/v1/organizations/:organizationId/suppliers` (List with pagination, sorting, search, filtering)
- `POST /api/v1/organizations/:organizationId/suppliers` (Create)
- `GET /api/v1/organizations/:organizationId/suppliers/:supplierId` (Get by ID)
- `PATCH /api/v1/organizations/:organizationId/suppliers/:supplierId` (Update)
- `DELETE /api/v1/organizations/:organizationId/suppliers/:supplierId` (Archive)
- `POST /api/v1/organizations/:organizationId/suppliers/:supplierId/restore` (Restore)

### Addresses

- `GET /api/v1/organizations/:organizationId/suppliers/:supplierId/addresses` (List addresses)
- `POST /api/v1/organizations/:organizationId/suppliers/:supplierId/addresses` (Create address)
- `PATCH /api/v1/organizations/:organizationId/suppliers/:supplierId/addresses/:addressId` (Update address)
- `DELETE /api/v1/organizations/:organizationId/suppliers/:supplierId/addresses/:addressId` (Delete address)

## Audit Logging

Comprehensive audit logs are emitted for:
- `SUPPLIER_CREATED`
- `SUPPLIER_UPDATED`
- `SUPPLIER_ARCHIVED`
- `SUPPLIER_RESTORED`
- `SUPPLIER_ADDRESS_CREATED`
- `SUPPLIER_ADDRESS_UPDATED`
- `SUPPLIER_ADDRESS_DELETED`
