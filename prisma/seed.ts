import 'dotenv/config';
import { PrismaClient, AccountType, AccountCategory } from '@prisma/client';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';

const connectionString = process.env.DATABASE_URL;
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const permissions = [
  { action: 'customer:read', description: 'Read customer records' },
  { action: 'customer:create', description: 'Create customer records' },
  { action: 'customer:update', description: 'Update customer records' },
  { action: 'customer:archive', description: 'Archive customer records' },
  
  { action: 'supplier:read', description: 'Read supplier records' },
  { action: 'supplier:create', description: 'Create supplier records' },
  { action: 'supplier:update', description: 'Update supplier records' },
  { action: 'supplier:archive', description: 'Archive supplier records' },

  { action: 'product:read', description: 'Read product records' },
  { action: 'product:create', description: 'Create product records' },
  { action: 'product:update', description: 'Update product records' },
  { action: 'product:archive', description: 'Archive product records' },

  { action: 'category:read', description: 'Read category records' },
  { action: 'category:create', description: 'Create category records' },
  { action: 'category:update', description: 'Update category records' },
  { action: 'category:archive', description: 'Archive category records' },

  { action: 'inventory:read', description: 'Read inventory levels' },
  { action: 'inventory:stock-in', description: 'Stock in inventory' },
  { action: 'inventory:stock-out', description: 'Stock out inventory' },
  { action: 'inventory:adjust', description: 'Adjust inventory levels' },

  { action: 'sale:read', description: 'Read sale records' },
  { action: 'sale:create', description: 'Create sale records' },
  { action: 'sale:update', description: 'Update sale records' },
  { action: 'sale:cancel', description: 'Cancel sale records' },

  { action: 'purchase:read', description: 'Read purchase records' },
  { action: 'purchase:create', description: 'Create purchase records' },
  { action: 'purchase:update', description: 'Update purchase records' },
  { action: 'purchase:cancel', description: 'Cancel purchase records' },

  { action: 'payment:read', description: 'Read payment records' },
  { action: 'payment:create', description: 'Create payment records' },
  { action: 'payment:void', description: 'Void payment records' },

  { action: 'expense:read', description: 'Read expense records' },
  { action: 'expense:create', description: 'Create expense records' },
  { action: 'expense:cancel', description: 'Cancel expense records' },
  { action: 'expense-category:read', description: 'Read expense categories' },
  { action: 'expense-category:create', description: 'Create expense categories' },
  { action: 'expense-category:update', description: 'Update expense categories' },

  { action: 'ledger:read', description: 'Read ledger balances and history' },
  { action: 'ledger:account-read', description: 'Read chart of accounts' },
  { action: 'ledger:account-create', description: 'Create ledger accounts' },
  { action: 'ledger:account-update', description: 'Update ledger accounts' },
  { action: 'ledger:journal-read', description: 'Read journal entries' },
  { action: 'ledger:journal-create', description: 'Create manual journal entries' },
  { action: 'ledger:reverse', description: 'Reverse posted journal entries' },

  { action: 'invoice:read', description: 'Read invoice records' },
  { action: 'invoice:create', description: 'Create invoice records' },
  { action: 'invoice:download', description: 'Download invoice records' },

  { action: 'report:read', description: 'Read business reports' },

  { action: 'member:read', description: 'Read organization members' },
  { action: 'member:invite', description: 'Invite organization members' },
  { action: 'member:update', description: 'Update organization members' },
  { action: 'member:remove', description: 'Remove organization members' },

  { action: 'role:read', description: 'Read custom roles' },
  { action: 'role:create', description: 'Create custom roles' },
  { action: 'role:update', description: 'Update custom roles' },
  { action: 'role:delete', description: 'Delete custom roles' },

  { action: 'organization:read', description: 'Read organization details' },
  { action: 'organization:update', description: 'Update organization details' },

  { action: 'business:read', description: 'Read business profile' },
  { action: 'business:create', description: 'Create business profile' },
  { action: 'business:update', description: 'Update business profile' },

  { action: 'branch:read', description: 'Read branches' },
  { action: 'branch:create', description: 'Create branches' },
  { action: 'branch:update', description: 'Update branches' },
  { action: 'branch:archive', description: 'Archive branches' },

  { action: 'subscription:read', description: 'Read subscription plan and usage' },
  { action: 'subscription:update', description: 'Manage subscription plan and billing' },
];

const systemRoles = {
  OWNER: permissions.map(p => p.action), // OWNER gets all permissions
  ADMIN: permissions.map(p => p.action).filter(p => !['organization:update', 'business:create'].includes(p)),
  MANAGER: [
    'customer:read', 'customer:create', 'customer:update', 'customer:archive',
    'supplier:read', 'supplier:create', 'supplier:update', 'supplier:archive',
    'product:read', 'product:create', 'product:update', 'product:archive',
    'category:read', 'category:create', 'category:update', 'category:archive',
    'inventory:read', 'inventory:stock-in', 'inventory:stock-out', 'inventory:adjust',
    'sale:read', 'sale:create', 'sale:update', 'sale:cancel',
    'purchase:read', 'purchase:create', 'purchase:update', 'purchase:cancel',
    'payment:read', 'payment:create',
    'expense:read', 'expense:create', 'expense:cancel',
    'expense-category:read', 'expense-category:create', 'expense-category:update',
    'ledger:read', 'ledger:account-read', 'ledger:journal-read',
    'invoice:read', 'invoice:create', 'invoice:download',
    'report:read', 'member:read',
    'branch:read', 'branch:create', 'branch:update', 'branch:archive'
  ],
  STAFF: [
    'customer:read', 'customer:create',
    'product:read', 'category:read', 'inventory:read', 'inventory:stock-in', 'inventory:stock-out',
    'sale:read', 'sale:create',
    'payment:read', 'payment:create',
    'invoice:read', 'invoice:create',
    'branch:read'
  ],
  ACCOUNTANT: [
    'customer:read', 'supplier:read',
    'sale:read', 'purchase:read',
    'payment:read', 'payment:create', 'payment:void',
    'expense:read', 'expense:create', 'expense:cancel',
    'expense-category:read', 'expense-category:create', 'expense-category:update',
    'ledger:read', 'ledger:account-read', 'ledger:account-create', 'ledger:account-update',
    'ledger:journal-read', 'ledger:journal-create', 'ledger:reverse',
    'invoice:read', 'invoice:download',
    'report:read',
    'business:read'
  ],
};

async function main() {
  console.log('Seeding permissions...');
  
  // Upsert all permissions
  for (const perm of permissions) {
    await prisma.permission.upsert({
      where: { action: perm.action },
      update: { description: perm.description },
      create: perm,
    });
  }

  // Fetch all permissions from DB to get their IDs
  const dbPermissions = await prisma.permission.findMany();
  const permissionMap = new Map(dbPermissions.map(p => [p.action, p.id]));

  console.log('Seeding system roles...');

  for (const [roleName, roleActions] of Object.entries(systemRoles)) {
    // We create system roles with organizationId: null
    // But since it's a unique constraint, we have to find it first.
    let role = await prisma.role.findFirst({
      where: {
        name: roleName,
        organizationId: null,
      },
    });

    if (!role) {
      role = await prisma.role.create({
        data: {
          name: roleName,
          organizationId: null,
        },
      });
    }

    // Now link permissions
    const permissionIds = roleActions.map(action => permissionMap.get(action)).filter(Boolean) as string[];
    
    // Instead of doing multiple queries, we can just delete all role permissions and re-insert them
    await prisma.rolePermission.deleteMany({
      where: { roleId: role.id },
    });

    if (permissionIds.length > 0) {
      await prisma.rolePermission.createMany({
        data: permissionIds.map(permissionId => ({
          roleId: role!.id,
          permissionId,
        })),
        skipDuplicates: true,
      });
    }
  }

  // Seed Subscription Plans (FREE, PRO, ENTERPRISE)
  console.log('Seeding subscription plans...');
  const plans = [
    {
      code: 'FREE',
      name: 'Free Plan',
      description: 'Free tier for small shop testing',
      price: 0,
      priceMonthly: 0,
      priceYearly: 0,
      maxBranches: 1,
      maxStaff: 2,
      maxProducts: 100,
      maxTransactions: 500,
      features: {},
    },
    {
      code: 'PRO',
      name: 'Pro Plan',
      description: 'Professional tier for growing businesses',
      price: 999,
      priceMonthly: 999,
      priceYearly: 9990,
      maxBranches: 5,
      maxStaff: 10,
      maxProducts: 5000,
      maxTransactions: 10000,
      features: { multiBranch: true, advancedReports: true },
    },
    {
      code: 'ENTERPRISE',
      name: 'Enterprise Plan',
      description: 'Scale without boundaries',
      price: 2999,
      priceMonthly: 2999,
      priceYearly: 29990,
      maxBranches: 20,
      maxStaff: 50,
      maxProducts: 50000,
      maxTransactions: 100000,
      features: { multiBranch: true, advancedReports: true, prioritySupport: true },
    },
  ];

  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      update: plan,
      create: plan,
    });
  }

  // Seed Default Admin & Owner Users (Development/Test only)
  if (process.env.NODE_ENV === 'production') {
    console.log('Skipping default demo accounts seeding in production environment.');
    console.log('Seeding completed.');
    return;
  }

  console.log('Seeding development test accounts...');
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@bebshaos.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123456';
  const hashedPassword = await argon2.hash(adminPassword, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail.toLowerCase() },
    update: {
      name: 'Super Admin',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      password: hashedPassword,
    },
    create: {
      name: 'Super Admin',
      email: adminEmail.toLowerCase(),
      password: hashedPassword,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  // Ensure default Organization exists for admin
  console.log('Seeding default organization for admin...');
  let org = await prisma.organization.findFirst({
    where: { slug: 'bebshaos-demo' },
  });

  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: 'BebshaOS HQ',
        slug: 'bebshaos-demo',
        status: 'ACTIVE',
      },
    });
  }

  // Ensure OWNER role for this organization exists
  let ownerRole = await prisma.role.findFirst({
    where: { organizationId: org.id, name: 'OWNER' },
  });

  if (!ownerRole) {
    ownerRole = await prisma.role.create({
      data: {
        organizationId: org.id,
        name: 'OWNER',
      },
    });
  }

  // Add Admin User as OWNER member in organization
  await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: {
        organizationId: org.id,
        userId: adminUser.id,
      },
    },
    update: {
      roleId: ownerRole.id,
      status: 'ACTIVE',
    },
    create: {
      organizationId: org.id,
      userId: adminUser.id,
      roleId: ownerRole.id,
      status: 'ACTIVE',
    },
  });

  // Ensure default branch exists
  await prisma.branch.upsert({
    where: {
      organizationId_code: {
        organizationId: org.id,
        code: 'MAIN',
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      name: 'Main Branch',
      code: 'MAIN',
      isDefault: true,
      status: 'ACTIVE',
    },
  });

  // Ensure system accounts exist for the org
  const SYSTEM_ACCOUNTS = [
    { code: '1000', name: 'Cash', type: AccountType.ASSET, category: AccountCategory.CASH },
    { code: '1010', name: 'Bank', type: AccountType.ASSET, category: AccountCategory.BANK },
    { code: '1100', name: 'Accounts Receivable', type: AccountType.ASSET, category: AccountCategory.ACCOUNTS_RECEIVABLE },
    { code: '1200', name: 'Inventory', type: AccountType.ASSET, category: AccountCategory.INVENTORY },
    { code: '2000', name: 'Accounts Payable', type: AccountType.LIABILITY, category: AccountCategory.ACCOUNTS_PAYABLE },
    { code: '3000', name: 'Owner Equity', type: AccountType.EQUITY, category: AccountCategory.OWNER_EQUITY },
    { code: '4000', name: 'Sales Revenue', type: AccountType.REVENUE, category: AccountCategory.SALES_REVENUE },
    { code: '5000', name: 'General Expense', type: AccountType.EXPENSE, category: AccountCategory.GENERAL_EXPENSE },
    { code: '5100', name: 'Cost of Goods Sold', type: AccountType.EXPENSE, category: AccountCategory.COST_OF_GOODS_SOLD },
  ];

  for (const acct of SYSTEM_ACCOUNTS) {
    await prisma.account.upsert({
      where: { organizationId_code: { organizationId: org.id, code: acct.code } },
      update: {},
      create: {
        organizationId: org.id,
        code: acct.code,
        name: acct.name,
        type: acct.type,
        category: acct.category,
        isSystem: true,
        isActive: true,
      },
    });
  }

  // Ensure active subscription exists for organization
  const freePlan = await prisma.plan.findUnique({ where: { code: 'FREE' } });
  if (freePlan) {
    const existingSub = await prisma.subscription.findFirst({
      where: { organizationId: org.id },
    });

    if (!existingSub) {
      const now = new Date();
      const currentPeriodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const currentPeriodEnd = new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), 1));

      await prisma.subscription.create({
        data: {
          organizationId: org.id,
          planId: freePlan.id,
          status: 'ACTIVE',
          billingCycle: 'MONTHLY',
          currentPeriodStart,
          currentPeriodEnd,
          provider: 'INTERNAL_SYSTEM',
        },
      });
    }
  }

  // Ensure Business profile exists for the store
  await prisma.business.upsert({
    where: { organizationId: org.id },
    update: {},
    create: {
      organizationId: org.id,
      name: 'BebshaOS HQ Store',
      currency: 'BDT',
      timezone: 'Asia/Dhaka',
      phone: '+8801700000000',
      email: 'store@bebshaos.com',
      address: 'Dhaka, Bangladesh',
    },
  });

  // Seed Dedicated Store Owner User
  console.log('Seeding store owner credentials...');
  const ownerEmail = process.env.OWNER_EMAIL || 'owner@bebshaos.com';
  const ownerPassword = process.env.OWNER_PASSWORD || 'Owner@123456';
  const hashedOwnerPassword = await argon2.hash(ownerPassword, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const ownerUser = await prisma.user.upsert({
    where: { email: ownerEmail.toLowerCase() },
    update: {
      name: 'Store Owner',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      password: hashedOwnerPassword,
    },
    create: {
      name: 'Store Owner',
      email: ownerEmail.toLowerCase(),
      password: hashedOwnerPassword,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  // Add Store Owner as OWNER member in organization
  await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: {
        organizationId: org.id,
        userId: ownerUser.id,
      },
    },
    update: {
      roleId: ownerRole.id,
      status: 'ACTIVE',
    },
    create: {
      organizationId: org.id,
      userId: ownerUser.id,
      roleId: ownerRole.id,
      status: 'ACTIVE',
    },
  });

  console.log('Seeding completed successfully.');
  console.log(`Platform Admin initialized: ${adminEmail}`);
  console.log(`Store Owner initialized:    ${ownerEmail} (Store: ${org.name})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
