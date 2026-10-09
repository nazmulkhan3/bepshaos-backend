import { PartialType, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { BranchStatus } from '@prisma/client';
import { CreateBranchDto } from './create-branch.dto.js';

export class UpdateBranchDto extends PartialType(CreateBranchDto) {
  @ApiPropertyOptional({ enum: BranchStatus, description: 'Status of the branch' })
  @IsOptional()
  @IsEnum(BranchStatus)
  status?: BranchStatus;
}
