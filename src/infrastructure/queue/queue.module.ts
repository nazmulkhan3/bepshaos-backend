import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const url = configService.get<string>('REDIS_URL');
        const urlObj = new URL(url || 'redis://localhost:6379');
        return {
          connection: {
            host: urlObj.hostname,
            port: parseInt(urlObj.port) || 6379,
            password: urlObj.password || undefined,
          },
          defaultJobOptions: {
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 1000,
            },
            removeOnComplete: true,
            removeOnFail: false,
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
})
export class QueueModule {}
