import { Module, Global, OnApplicationShutdown, Inject, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: (configService: ConfigService) => {
        const logger = new Logger('RedisModule');
        const url = configService.get<string>('redis.url') || 'redis://localhost:6379';
        const client = new Redis(url, {
          lazyConnect: true,
          enableOfflineQueue: false,
        });
        client.on('error', (err) => {
          logger.warn(`Redis connection error: ${err.message}`);
        });
        return client;
      },
      inject: [ConfigService],
    },
  ],
  exports: ['REDIS_CLIENT'],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject('REDIS_CLIENT') private readonly redisClient: Redis) {}

  async onApplicationShutdown() {
    try {
      if (this.redisClient.status === 'ready') {
        await this.redisClient.quit();
      } else {
        this.redisClient.disconnect();
      }
    } catch {
      // ignore shutdown errors
    }
  }
}

