import { IsString, IsNotEmpty, IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddMemberDto {
  @ApiProperty({ description: 'User ID of the member to add', example: 'user-uuid' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ description: 'Role ID to assign within the organization', example: 'role-uuid' })
  @IsString()
  @IsNotEmpty()
  roleId: string;
}
