import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SupplierStatus } from '@prisma/client';
import { SupplierAddressDto } from './supplier-address.dto.js';

export class SupplierDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  organizationId: string;

  @ApiProperty()
  supplierCode: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  companyName?: string;

  @ApiPropertyOptional()
  avatar?: string;

  @ApiPropertyOptional()
  phone?: string;

  @ApiPropertyOptional()
  alternatePhone?: string;

  @ApiPropertyOptional()
  email?: string;

  @ApiPropertyOptional()
  website?: string;

  @ApiPropertyOptional()
  taxNumber?: string;


  @ApiPropertyOptional()
  notes?: string;

  @ApiProperty({ enum: SupplierStatus })
  status: SupplierStatus;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional({ type: () => [SupplierAddressDto] })
  addresses?: SupplierAddressDto[];

  constructor(partial: Partial<SupplierDto>) {
    Object.assign(this, partial);

  }
}
