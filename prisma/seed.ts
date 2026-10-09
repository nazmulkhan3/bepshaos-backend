import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

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

  console.log('Seeding completed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
