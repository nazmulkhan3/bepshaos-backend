import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';
import { AppLogger } from './common/utils/logger.js';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const appLogger = new AppLogger();
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);

  // Enable graceful shutdown
  app.enableShutdownHooks();

  // Global Prefix
  app.setGlobalPrefix('api/v1');

  // Security
  app.use(helmet());
  
  const corsOrigins = configService.get<string>('cors.origins');
  app.enableCors({
    origin: corsOrigins ? corsOrigins.split(',') : '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Exception Handling
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Swagger Documentation
  const config = new DocumentBuilder()
    .setTitle('BebshaOS API')
    .setDescription('BebshaOS is a multi-tenant business management SaaS platform.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  appLogger.log(`Application is running on: http://localhost:${port}/api/v1`);
  appLogger.log(`Swagger documentation is available at: http://localhost:${port}/api/docs`);
}
bootstrap().catch((err) => {
  console.error('Error during bootstrap', err);
  process.exit(1);
});
