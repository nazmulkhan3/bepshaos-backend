export enum QuotaResourceType {
  BRANCH = 'BRANCH',
  STAFF = 'STAFF',
  PRODUCT = 'PRODUCT',
  TRANSACTION = 'TRANSACTION',
}

export interface PlanLimits {
  maxBranches: number | null; // null represents unlimited
  maxStaff: number | null;
  maxProducts: number | null;
  maxTransactions: number | null;
}

export interface SubscriptionUsage {
  branches: {
    used: number;
    limit: number | null;
  };
  staff: {
    used: number;
    limit: number | null;
  };
  products: {
    used: number;
    limit: number | null;
  };
  transactions: {
    used: number;
    limit: number | null;
    periodStart: Date;
    periodEnd: Date;
  };
}
