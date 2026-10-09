# Branches Module Documentation

## Overview
The Branches module allows an organization to have multiple physical or virtual branches. It is a `1:N` relationship with the `Organization`. Branches can be used to segregate sales, inventory, or operational logic within the same tenant.

## Architecture

- **Model**: `Branch`
- **Relationship**: Belongs to `Organization`.
- **Constraints**: 
  - Branch `code` must be unique **within** an organization (using `@@unique([organizationId, code])`).
  - Two different organizations can have a branch with the same code (e.g., both can have a "MAIN" branch).
- **Default Branch Logic**:
  - One branch can be marked as the default (`isDefault: true`).
  - Changing the default branch uses a database `$transaction` to ensure atomic switching (setting the old default to false and the new one to true simultaneously).
- **Security**: 
  - Protected by `TenantGuard` and `PermissionGuard` (`branch:read`, `branch:create`, `branch:update`, `branch:delete`).

## Endpoints

### 1. Create a Branch
- **Method**: `POST /v1/organizations/:organizationId/branches`
- **Permissions Required**: `branch:create`
- **Body Payload**:
  ```json
  {
    "name": "Headquarters",
    "code": "HQ",
    "email": "hq@example.com",
    "phone": "+1234567890",
    "address": "123 Main St",
    "isDefault": true
  }
  ```
- **Behavior**: If it's the first branch created in the organization, it will automatically become the default branch regardless of the `isDefault` flag in the payload.

### 2. List Branches
- **Method**: `GET /v1/organizations/:organizationId/branches`
- **Permissions Required**: `branch:read`
- **Query Parameters**: Supports pagination (`page`, `limit`, `orderBy`).
- **Returns**: Paginated list of branches.

### 3. Get Single Branch
- **Method**: `GET /v1/organizations/:organizationId/branches/:branchId`
- **Permissions Required**: `branch:read`
- **Returns**: The specific branch.

### 4. Update a Branch
- **Method**: `PATCH /v1/organizations/:organizationId/branches/:branchId`
- **Permissions Required**: `branch:update`
- **Returns**: The updated branch.
- **Behavior**: If `isDefault: true` is passed, it will transactionally remove the default flag from the current default branch and assign it to this branch.

### 5. Archive/Delete a Branch
- **Method**: `DELETE /v1/organizations/:organizationId/branches/:branchId`
- **Permissions Required**: `branch:delete`
- **Behavior**: Currently implements a status update to `ARCHIVED`.
- **Constraints**: You **cannot** archive the default branch. It will throw a `400 Bad Request`.
