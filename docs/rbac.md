# BebshaOS RBAC (Phase 06)

This document describes the Roles and Permissions (RBAC) system implemented in BebshaOS.

## Architecture

The authorization model is organization-scoped to support multi-tenancy. No authorization bypasses organization boundaries.

```
User -> OrganizationMember -> Role -> Permission -> Action
```

- **User**: The authenticated entity.
- **OrganizationMember**: Links a user to an organization and assigns a role.
- **Role**: A collection of permissions. Can be system-defined (global) or custom (scoped to an organization).
- **Permission**: Represents an action on a resource (e.g., `member:read`, `organization:update`).

## System Roles

By default, the following system roles are available across all organizations:
- **OWNER**: Full access to all features, including organization settings and roles.
- **ADMIN**: Administrative access, managing members and settings, but cannot delete the organization.
- **MANAGER**: Management capabilities for business entities (sales, products, etc.).
- **STAFF**: Standard operational access.
- **ACCOUNTANT**: Access restricted to billing and financial resources.

System roles have `organizationId = null` in the database.

## Custom Roles

Organization owners can create custom roles. Custom roles are assigned an `organizationId` and are only visible and assignable within that specific organization.

## Implementation Details

### Guards

1. **`JwtAuthGuard`**: Ensures the user is authenticated globally (via Passport JWT strategy).
2. **`TenantGuard`**: Extracts `x-organization-id` from the header, validates that the user is an active member of that organization, and injects `organizationContext` into the request.
3. **`PermissionGuard`**: Uses the `@RequirePermissions` decorator metadata to check if the member's role includes the required permissions for the endpoint.

### Decorators

- **`@RequirePermissions('resource:action')`**: Applied to controller methods to enforce access control. Example: `@RequirePermissions('member:read')`.

### Owner Protection

The system enforces that every active organization has at least one active `OWNER`. If an operation attempts to change the role of the last active owner, a `ForbiddenException` is thrown.

## Seeding

System roles and foundational permissions are seeded into the database using `prisma/seed.ts`.
Run the seed using:
```bash
npx prisma db seed
```
