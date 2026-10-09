import { Module } from '@nestjs/common';
import { OrganizationService } from './organization.service.js';
import { OrganizationController } from './organization.controller.js';
import { RoleController } from './role.controller.js';
import { RoleService } from './role.service.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { SubscriptionModule } from '../subscription/subscription.module.js';

@Module({
  imports: [AuthorizationModule, LedgerModule, SubscriptionModule],
  controllers: [OrganizationController, RoleController],
  providers: [OrganizationService, RoleService],
  exports: [OrganizationService, RoleService],
})
export class OrganizationModule {}
