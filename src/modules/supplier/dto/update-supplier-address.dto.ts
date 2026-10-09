import { PartialType } from '@nestjs/swagger';
import { CreateSupplierAddressDto } from './create-supplier-address.dto.js';

export class UpdateSupplierAddressDto extends PartialType(CreateSupplierAddressDto) {}
