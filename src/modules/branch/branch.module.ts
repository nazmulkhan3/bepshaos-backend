import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { SubscriptionModule } from '../subscription/subscription.module.js';
import { BranchService } from './branch.service.js';
import { BranchController } from './branch.controller.js';

@Module({
  imports: [AuthorizationModule, SubscriptionModule],
  controllers: [BranchController],
  providers: [BranchService],
  exports: [BranchService],
})
export class BranchModule {}
