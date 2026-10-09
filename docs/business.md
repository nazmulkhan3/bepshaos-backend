# Business Module Documentation

## Overview
The Business module manages the business profile of an organization. Each organization (`Tenant`) in BebshaOS has exactly **one** business profile (a `1:1` relationship). It stores business-specific details such as tax settings, currency, and timezone, which apply across the entire organization.

## Architecture

- **Model**: `Business`
- **Relationship**: Belongs to `Organization` (`organizationId` is the unique foreign key).
- **Security**: 
  - Accessed via `/v1/organizations/:organizationId/business`
  - Protected by `TenantGuard` (verifies the user is a member of the organization).
  - Protected by `PermissionGuard` (requires specific permissions like `business:read` and `business:update`).
  - Strict Cross-Tenant isolation is enforced. Users cannot access a Business profile of an organization they don't belong to.

## Endpoints

### 1. Initialize Business Profile
- **Method**: `POST /v1/organizations/:organizationId/business`
- **Permissions Required**: `business:create` (Usually granted to `OWNER`)
- **Body Payload**:
  ```json
  {
    "name": "Acme Inc.",
    "registrationNumber": "12345",
    "taxEnabled": true,
    "taxNumber": "TAX123",
    "currency": "USD",
    "timezone": "UTC"
  }
  ```
- **Returns**: The created business profile.
- **Note**: Will throw `409 Conflict` if a business profile already exists for the organization.

### 2. Get Business Profile
- **Method**: `GET /v1/organizations/:organizationId/business`
- **Permissions Required**: `business:read`
- **Returns**: The business profile for the specified organization. Throw `404` if not found.

### 3. Update Business Profile
- **Method**: `PATCH /v1/organizations/:organizationId/business`
- **Permissions Required**: `business:update`
- **Body Payload**: Any subset of the business fields.
- **Returns**: The updated business profile.
