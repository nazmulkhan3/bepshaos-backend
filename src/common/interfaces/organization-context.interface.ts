import { MemberStatus, OrganizationStatus } from '@prisma/client';

export interface OrganizationContext {
  organizationId: string;
  userId: string;
  membershipId: string;
  roleId: string;
  roleName: string;
  status: MemberStatus;
  organizationStatus: OrganizationStatus;
}
