import { Module } from '@nestjs/common';
import { ProductService } from './product.service.js';
import { ProductController } from './product.controller.js';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { SubscriptionModule } from '../subscription/subscription.module.js';

@Module({
  imports: [DatabaseModule, AuthorizationModule, SubscriptionModule],
  controllers: [ProductController],
  providers: [ProductService],
  exports: [ProductService],
})
export class ProductModule {}
