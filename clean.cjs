const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function clean() {
  await prisma.supplierAddress.deleteMany({});
  await prisma.supplier.deleteMany({});
  await prisma.organizationMember.deleteMany({});
  await prisma.role.deleteMany({ where: { organizationId: { not: null } } });
  await prisma.organization.deleteMany({});
  await prisma.session.deleteMany({});
  await prisma.user.deleteMany({});
  console.log('Database Cleaned');
}

clean().finally(() => prisma.$disconnect());
