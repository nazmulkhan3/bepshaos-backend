import { Module } from '@nestjs/common';
import { SyncService } from './sync.service.js';
import { SyncController } from './sync.controller.js';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { CustomerModule } from '../customer/customer.module.js';
import { ProductModule } from '../product/product.module.js';
import { CategoryModule } from '../category/category.module.js';

@Module({
  imports: [
    DatabaseModule,
    AuthorizationModule,
    AuditLogModule,
    SalesModule,
    InventoryModule,
    CustomerModule,
    ProductModule,
    CategoryModule,
  ],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
