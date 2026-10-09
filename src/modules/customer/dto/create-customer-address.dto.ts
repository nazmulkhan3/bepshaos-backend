import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCustomerAddressDto {
  @ApiPropertyOptional({ example: 'Home' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  label?: string;

  @ApiProperty({ example: '123 Main Street' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  addressLine1: string;

  @ApiPropertyOptional({ example: 'Apt 4B' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  addressLine2?: string;

  @ApiPropertyOptional({ example: 'Gulshan' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  area?: string;

  @ApiPropertyOptional({ example: 'Dhaka' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ example: 'Dhaka' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  district?: string;

  @ApiPropertyOptional({ example: '1212' })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  postalCode?: string;

  @ApiPropertyOptional({ example: 'Bangladesh', default: 'Bangladesh' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  country?: string;

  @ApiPropertyOptional({ example: true, default: false })
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}
