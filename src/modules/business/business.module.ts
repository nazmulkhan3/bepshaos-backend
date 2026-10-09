import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { BusinessService } from './business.service.js';
import { BusinessController } from './business.controller.js';

@Module({
  imports: [AuthorizationModule],
  controllers: [BusinessController],
  providers: [BusinessService],
  exports: [BusinessService],
})
export class BusinessModule {}
