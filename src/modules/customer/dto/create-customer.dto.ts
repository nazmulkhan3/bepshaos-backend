import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, IsNumberString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCustomerDto {
  @ApiProperty({ example: 'Rahim Traders', description: 'Customer business or personal name' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'rahim@example.com' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: '01712345678' })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ example: '01812345678' })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  alternatePhone?: string;

  @ApiPropertyOptional({ example: 'Regular wholesale customer' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ example: '50000', description: 'Credit limit for this customer' })
  @IsNumberString()
  @IsOptional()
  creditLimit?: string;

  @ApiPropertyOptional({ example: '1000', description: 'Initial opening balance' })
  @IsNumberString()
  @IsOptional()
  openingBalance?: string;

  @ApiPropertyOptional({ example: 'https://example.com/avatar.jpg' })
  @IsString()
  @IsOptional()
  avatar?: string;
}
