import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_INTERCEPTOR } from '@nestjs/core';
import configuration from './config/configuration.js';
import { validate } from './config/env.validation.js';
import { DatabaseModule } from './database/database.module.js';
import { RedisModule } from './infrastructure/redis/redis.module.js';
import { QueueModule } from './infrastructure/queue/queue.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { AppController } from './app.controller.js';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware.js';
import { LoggingMiddleware } from './common/middleware/logging.middleware.js';
import { ResponseInterceptor } from './common/interceptors/response.interceptor.js';
import { OrganizationModule } from './modules/organization/organization.module.js';
import { AuthorizationModule } from './modules/authorization/authorization.module.js';
import { BusinessModule } from './modules/business/business.module.js';
import { BranchModule } from './modules/branch/branch.module.js';
import { CustomerModule } from './modules/customer/customer.module.js';
import { SupplierModule } from './modules/supplier/supplier.module.js';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard.js';
import { CategoryModule } from './modules/category/category.module.js';
import { ProductModule } from './modules/product/product.module.js';
import { InventoryModule } from './modules/inventory/inventory.module.js';
import { SalesModule } from './modules/sales/sales.module.js';

import { PurchasesModule } from './modules/purchases/purchases.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { LedgerModule } from './modules/ledger/ledger.module.js';
import { ExpensesModule } from './modules/expenses/expenses.module.js';
import { InvoiceModule } from './modules/invoice/invoice.module.js';
import { ReceiptModule } from './modules/receipt/receipt.module.js';
import { ReportModule } from './modules/report/report.module.js';
import { NotificationModule } from './modules/notification/notification.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [configuration],
      validate,
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>('rateLimit.ttl') || 60000,
          limit: config.get<number>('rateLimit.limit') || 100,
        },
      ],
    }),
    DatabaseModule,
    RedisModule,
    QueueModule,
    HealthModule,
    AuthModule,
    OrganizationModule,
    AuthorizationModule,
    BusinessModule,
    BranchModule,
    CustomerModule,
    SupplierModule,
    CategoryModule,
    ProductModule,
    InventoryModule,
    SalesModule,
    PurchasesModule,
    PaymentsModule,
    LedgerModule,
    ExpensesModule,
    InvoiceModule,
    ReceiptModule,
    ReportModule,
    NotificationModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware, LoggingMiddleware).forRoutes('*');
  }
}

