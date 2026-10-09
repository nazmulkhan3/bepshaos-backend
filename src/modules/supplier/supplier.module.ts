import { Module } from '@nestjs/common';
import { SupplierService } from './supplier.service.js';
import { SupplierController } from './supplier.controller.js';
import { SupplierAddressService } from './supplier-address.service.js';
import { SupplierAddressController } from './supplier-address.controller.js';
import { DatabaseModule } from '../../database/database.module.js';

import { AuthorizationModule } from '../authorization/authorization.module.js';

@Module({
  imports: [DatabaseModule, AuthorizationModule],
  controllers: [SupplierController, SupplierAddressController],
  providers: [SupplierService, SupplierAddressService],
  exports: [SupplierService, SupplierAddressService],
})
export class SupplierModule {}
