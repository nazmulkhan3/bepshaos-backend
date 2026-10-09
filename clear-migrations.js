import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = 'postgresql://neondb_owner:npg_UZI9SrHLOW4v@ep-silent-shape-b3y7jldc-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function clearMigrations() {
  try {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "_prisma_migrations";`);
    console.log('Successfully cleared _prisma_migrations table.');
  } catch (error) {
    console.error('Error clearing _prisma_migrations:', error);
  } finally {
    await prisma.$disconnect();
  }
}

clearMigrations();
