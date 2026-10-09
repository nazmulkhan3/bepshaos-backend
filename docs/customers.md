# BebshaOS - Customer Management Module

The Customer Management module provides a secure, multi-tenant system for managing organization-specific customer data.

## Architecture & Tenant Isolation

Every customer belongs strictly to one `Organization`. The module ensures that a customer cannot be accessed, updated, or manipulated without the correct `organizationId` context.
- The `TenantGuard` automatically injects the active `organizationId` into the controller scope.
- The `CustomerService` and `CustomerAddressService` enforce `organizationId` in every database query's `WHERE` clause.

## Customer Code Generation
When a new customer is created, they are assigned a unique, incremental code (e.g., `CUS-000001`). 
- This generation process is safely handled using a transactional query combined with Prisma's unique composite index (`organizationId`, `customerCode`).
- If a race condition occurs and a duplicate code exception is raised by the database, the service automatically increments and retries up to 5 times.

## Data Structures

### Customer
- **id**: UUID
- **organizationId**: UUID (Scope)
- **branchId**: UUID (Optional link for POS/Sales)
- **customerCode**: String (Unique per org)
- **name, email, phone, alternatePhone, avatar**: General contact info.
- **creditLimit, openingBalance**: Initial financial metadata using `Decimal(19, 4)`.
- **status**: `ACTIVE | INACTIVE | ARCHIVED`

### Customer Address
Addresses are handled via the `CustomerAddress` model to support Bangladesh-friendly, highly normalized address formats (area, city, district, postalCode, country).
- **isDefault**: Allows the customer to set one primary address. The service manages toggling the other addresses' default status when a new one is set as default.

## API Endpoints

### Customer API
- `POST /api/v1/organizations/:orgId/customers`: Create customer
- `GET /api/v1/organizations/:orgId/customers`: Paginated, sortable, and searchable list
- `GET /api/v1/organizations/:orgId/customers/:customerId`: Retrieve single customer (includes addresses)
- `PATCH /api/v1/organizations/:orgId/customers/:customerId`: Update details
- `DELETE /api/v1/organizations/:orgId/customers/:customerId`: Safely sets status to `ARCHIVED` (Soft Delete)

### Customer Address API
- `POST /api/v1/organizations/:orgId/customers/:customerId/addresses`: Add address
- `GET /api/v1/organizations/:orgId/customers/:customerId/addresses`: List addresses
- `PATCH /api/v1/organizations/:orgId/customers/:customerId/addresses/:addressId`: Update address
- `DELETE /api/v1/organizations/:orgId/customers/:customerId/addresses/:addressId`: Delete address

## Role Based Access Control (RBAC)

The following explicit permissions govern customer access:
- `customer:read`: Required for list, get, and searching.
- `customer:create`: Required for creating new customers.
- `customer:update`: Required for modifying customers or their addresses.
- `customer:archive`: Required for archiving a customer.

System Roles:
- **OWNER / ADMIN**: All customer permissions.
- **MANAGER**: Full access (`read`, `create`, `update`, `archive`).
- **STAFF**: `read`, `create`, `update`.
- **ACCOUNTANT**: `read`.
