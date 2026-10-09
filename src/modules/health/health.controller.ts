import { Controller, Get, Inject } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { Redis } from 'ioredis';
import { BypassResponseInterceptor } from '../../common/interceptors/response.interceptor.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly databaseService: DatabaseService,
    @Inject('REDIS_CLIENT') private readonly redisClient: Redis,
  ) {}

  @Get()
  @BypassResponseInterceptor()
  check() {
    return {
      status: 'ok',
      service: 'BebshaOS API',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('readiness')
  @BypassResponseInterceptor()
  async readiness() {
    let dbStatus = 'ok';
    let redisStatus = 'ok';
    let isReady = true;

    try {
      await this.databaseService.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'error';
      isReady = false;
    }

    try {
      await this.redisClient.ping();
    } catch {
      redisStatus = 'error';
      isReady = false;
    }

    return {
      status: isReady ? 'ok' : 'error',
      service: 'BebshaOS API',
      details: {
        database: dbStatus,
        redis: redisStatus,
      },
      timestamp: new Date().toISOString(),
    };
  }
}

