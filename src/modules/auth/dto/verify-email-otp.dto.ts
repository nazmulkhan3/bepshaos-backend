import { IsString, IsNotEmpty, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyEmailOtpDto {
  @ApiProperty({ example: 'user-id-uuid' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6)
  otp: string;
}
