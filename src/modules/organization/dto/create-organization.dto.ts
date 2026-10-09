import { IsString, IsOptional, IsEmail, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateOrganizationDto {
  @ApiProperty({ example: 'Acme Corp', description: 'The name of the organization' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}
