import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { BranchService } from './branch.service.js';
import { BranchController } from './branch.controller.js';

@Module({
  imports: [AuthorizationModule],
  controllers: [BranchController],
  providers: [BranchService],
  exports: [BranchService],
})
export class BranchModule {}
