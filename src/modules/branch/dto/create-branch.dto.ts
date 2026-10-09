import { IsString, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBranchDto {
  @ApiProperty({ description: 'Branch Name', example: 'Main Branch' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Branch Code', example: 'MAIN' })
  @IsString()
  code: string;

  @ApiPropertyOptional({ description: 'Email address' })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({ description: 'Physical address' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ description: 'Phone number' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ description: 'Set as default branch', default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
