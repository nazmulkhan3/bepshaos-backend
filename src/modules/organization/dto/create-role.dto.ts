import { IsString, IsNotEmpty, MaxLength, IsArray, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRoleDto {
  @ApiProperty({ example: 'Supervisor', description: 'The name of the custom role' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @ApiProperty({ example: ['product:read', 'product:create'], description: 'List of permission keys' })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  permissions: string[];
}
