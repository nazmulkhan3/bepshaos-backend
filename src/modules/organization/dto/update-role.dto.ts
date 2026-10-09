import { IsString, MaxLength, IsArray, IsOptional, ArrayMinSize } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateRoleDto {
  @ApiPropertyOptional({ example: 'Senior Supervisor', description: 'The new name of the custom role' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ example: ['product:read', 'product:create', 'product:update'], description: 'Updated list of permission keys' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  permissions?: string[];
}
