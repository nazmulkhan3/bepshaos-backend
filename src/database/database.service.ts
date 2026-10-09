import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * DatabaseService extends PrismaClient.
 * 
 * TRANSACTION GUIDELINES:
 * Do not create custom transaction abstractions. Use Prisma's native `$transaction`.
 * - Sequential Transactions: Use `this.$transaction([query1, query2])` for simple independent queries.
 * - Interactive Transactions: Use `this.$transaction(async (tx) => { ... })` when subsequent queries depend on previous query results.
 * - Keep transaction boundaries small to avoid long-running locks.
 */
@Injectable()
export class DatabaseService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    const pool = new Pool({
      connectionString,
      max: 30,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
    });
    const adapter = new PrismaPg(pool);
    super({ adapter });
  }

  async onModuleInit() {
    this.logger.log('Connecting to PostgreSQL via Prisma...');
    await this.$connect();
    this.logger.log('Connected to PostgreSQL database');
  }

  async onModuleDestroy() {
    this.logger.log('Disconnecting from PostgreSQL...');
    await this.$disconnect();
  }
}
