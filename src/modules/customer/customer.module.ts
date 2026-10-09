import { Module } from '@nestjs/common';
import { CustomerController } from './customer.controller.js';
import { CustomerService } from './customer.service.js';
import { CustomerAddressController } from './customer-address.controller.js';
import { CustomerAddressService } from './customer-address.service.js';

import { AuthorizationModule } from '../authorization/authorization.module.js';

@Module({
  imports: [AuthorizationModule],
  controllers: [CustomerController, CustomerAddressController],
  providers: [CustomerService, CustomerAddressService],
  exports: [CustomerService],
})
export class CustomerModule {}
