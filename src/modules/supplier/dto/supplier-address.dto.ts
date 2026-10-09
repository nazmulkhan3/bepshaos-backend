import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SupplierAddressDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  supplierId: string;

  @ApiPropertyOptional()
  label?: string;

  @ApiProperty()
  addressLine1: string;

  @ApiPropertyOptional()
  addressLine2?: string;

  @ApiPropertyOptional()
  area?: string;

  @ApiPropertyOptional()
  city?: string;

  @ApiPropertyOptional()
  district?: string;

  @ApiPropertyOptional()
  postalCode?: string;

  @ApiProperty()
  country: string;

  @ApiProperty()
  isDefault: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  constructor(partial: Partial<SupplierAddressDto>) {
    Object.assign(this, partial);
  }
}
