import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResendEmailOtpDto {
  @ApiProperty({ example: 'user-id-uuid' })
  @IsString()
  @IsNotEmpty()
  userId: string;
}
