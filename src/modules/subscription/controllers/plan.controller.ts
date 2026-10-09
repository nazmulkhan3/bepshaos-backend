import { Controller, Get, Post, Body, Param, Patch } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PlanService } from '../services/plan.service.js';
import { CreatePlanDto, UpdatePlanDto } from '../dto/plan.dto.js';

@ApiTags('Plans')
@Controller({ path: 'plans', version: '1' })
export class PlanController {
  constructor(private readonly planService: PlanService) {}

  @Get()
  @ApiOperation({ summary: 'List all active public subscription plans (Public)' })
  @ApiResponse({ status: 200, description: 'List of active plans' })
  async getPublicPlans() {
    const plans = await this.planService.getPublicPlans();
    return {
      success: true,
      data: plans,
    };
  }

  @Get(':code')
  @ApiOperation({ summary: 'Get details of a specific plan by code (Public)' })
  @ApiResponse({ status: 200, description: 'Plan details' })
  async getPlanByCode(@Param('code') code: string) {
    const plan = await this.planService.getPlanByCode(code);
    return {
      success: true,
      data: plan,
    };
  }
}
