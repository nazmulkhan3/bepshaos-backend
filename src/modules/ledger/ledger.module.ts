import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service.js';
import { LedgerController } from './ledger.controller.js';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';

@Module({
  imports: [DatabaseModule, AuthorizationModule],
  controllers: [LedgerController],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
