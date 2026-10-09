import { Module } from '@nestjs/common';
import { SalesService } from './sales.service.js';
import { SalesController } from './sales.controller.js';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';

@Module({
  imports: [DatabaseModule, AuthorizationModule, LedgerModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
