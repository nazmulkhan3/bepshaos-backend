import { IsString, IsOptional, IsBoolean } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

export class CreateBusinessDto {
  @ApiProperty({ description: 'Business Name', example: 'My Business' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Legal Name', example: 'My Business LLC' })
  @IsOptional()
  @IsString()
  legalName?: string;

  @ApiPropertyOptional({ description: 'Logo URL' })
  @IsOptional()
  @IsString()
  logo?: string;

  @ApiPropertyOptional({ description: 'Phone number' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ description: 'Email address' })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({ description: 'Website URL' })
  @IsOptional()
  @IsString()
  website?: string;

  @ApiPropertyOptional({ description: 'Physical address' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ description: 'Currency code', default: 'BDT' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: 'Timezone', default: 'Asia/Dhaka' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({ description: 'Is tax enabled?' })
  @IsOptional()
  @IsBoolean()
  taxEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Tax registration number' })
  @IsOptional()
  @IsString()
  taxNumber?: string;

  @ApiPropertyOptional({ description: 'Invoice prefix' })
  @IsOptional()
  @IsString()
  invoicePrefix?: string;

  @ApiPropertyOptional({ description: 'Invoice footer text' })
  @IsOptional()
  @IsString()
  invoiceFooter?: string;

  @ApiPropertyOptional({ description: 'Receipt footer text' })
  @IsOptional()
  @IsString()
  receiptFooter?: string;
}
