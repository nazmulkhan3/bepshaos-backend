import { IsString, IsNotEmpty, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PasswordResetConfirmDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  resetToken: string;

  @ApiProperty({ example: 'NewStrongPassword123!' })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
