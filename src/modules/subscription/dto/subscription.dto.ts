import { IsString, IsNotEmpty, IsOptional, IsIn, IsNumber, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ChangePlanDto {
  @ApiProperty({ description: 'Target plan code (e.g. FREE, STARTER, PRO, ENTERPRISE)', example: 'STARTER' })
  @IsString()
  @IsNotEmpty()
  planCode: string;

  @ApiProperty({ description: 'Billing cycle (MONTHLY or YEARLY)', example: 'MONTHLY', enum: ['MONTHLY', 'YEARLY'] })
  @IsString()
  @IsIn(['MONTHLY', 'YEARLY'])
  billingCycle: 'MONTHLY' | 'YEARLY';

  @ApiPropertyOptional({ description: 'Optional payment method or provider', example: 'MANUAL' })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional({ description: 'Optional provider payment/transaction ID for immediate settlement' })
  @IsOptional()
  @IsString()
  transactionId?: string;
}

export class CancelSubscriptionDto {
  @ApiPropertyOptional({ description: 'Reason for cancellation', example: 'Downsizing team' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({ description: 'Whether to cancel immediately or wait until period ends', default: false })
  @IsOptional()
  immediately?: boolean;
}

export class StartTrialDto {
  @ApiProperty({ description: 'Plan code to trial (defaults to PRO if not specified)', example: 'PRO', default: 'PRO' })
  @IsOptional()
  @IsString()
  planCode?: string;
}
