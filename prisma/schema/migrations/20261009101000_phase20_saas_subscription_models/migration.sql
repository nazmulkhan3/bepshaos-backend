-- Phase 20 Step 2: SaaS Plans, Subscriptions, Billing Records & Webhook Audit

-- AlterTable Organization
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "hasUsedTrial" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable Sale (Nullable completedAt + Historical Backfill)
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
UPDATE "Sale" 
SET "completedAt" = "createdAt" 
WHERE "status" = 'COMPLETED' AND "completedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "Sale_organizationId_status_completedAt_idx" 
ON "Sale"("organizationId", "status", "completedAt");

-- AlterTable Plan (Stage 1: Add columns with code as nullable)
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "code" TEXT;
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'BDT';
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "isPublic" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "priceMonthly" DECIMAL(19,4) NOT NULL DEFAULT 0;
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "priceYearly" DECIMAL(19,4) NOT NULL DEFAULT 0;
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Plan" ALTER COLUMN "maxBranches" DROP NOT NULL;
ALTER TABLE "Plan" ALTER COLUMN "maxStaff" DROP NOT NULL;
ALTER TABLE "Plan" ALTER COLUMN "maxStaff" SET DEFAULT 2;
ALTER TABLE "Plan" ALTER COLUMN "maxProducts" DROP NOT NULL;
ALTER TABLE "Plan" ALTER COLUMN "maxTransactions" DROP NOT NULL;
ALTER TABLE "Plan" ALTER COLUMN "maxTransactions" SET DEFAULT 500;
ALTER TABLE "Plan" ALTER COLUMN "features" SET NOT NULL;
ALTER TABLE "Plan" ALTER COLUMN "features" SET DEFAULT '{}';

-- Plan Pricing Backfill (Preserves legacy price, provisional 0 yearly price)
UPDATE "Plan"
SET "priceMonthly" = "price",
    "priceYearly" = 0.0000
WHERE "price" IS NOT NULL AND "priceMonthly" = 0;

-- Deterministic Plan Code Assignment
UPDATE "Plan"
SET "code" = UPPER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '_', 'g'))
WHERE "code" IS NULL;

UPDATE "Plan" p
SET "code" = p."code" || '_' || UPPER(SUBSTRING(REPLACE(p.id, '-', ''), 1, 4))
WHERE p.id IN (
    SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY "code" ORDER BY "createdAt" ASC, id ASC) as rn
        FROM "Plan"
    ) duplicates 
    WHERE duplicates.rn > 1
);

-- Plan Code Validation Check (Abort if collision persists)
DO $$
DECLARE
    v_code_collisions INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_code_collisions 
    FROM (SELECT "code" FROM "Plan" GROUP BY "code" HAVING COUNT(*) > 1) t;
    
    IF v_code_collisions > 0 THEN
        RAISE EXCEPTION 'MIGRATION ABORTED: Plan code collisions detected (%)', v_code_collisions;
    END IF;
END $$;

ALTER TABLE "Plan" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Plan_code_key" ON "Plan"("code");
CREATE INDEX IF NOT EXISTS "Plan_isActive_isPublic_idx" ON "Plan"("isActive", "isPublic");

-- Safe Canonical Free Plan Adoption & Seeding
DO $$
DECLARE
    v_has_canonical_free BOOLEAN;
    v_adopted_plan_id TEXT;
    v_free_count INTEGER;
BEGIN
    -- 1. Check if a plan with code = 'FREE' ALREADY exists
    SELECT EXISTS (
        SELECT 1 FROM "Plan" WHERE "code" = 'FREE'
    ) INTO v_has_canonical_free;

    -- 2. Only search for a legacy plan to adopt if NO canonical 'FREE' plan exists
    IF NOT v_has_canonical_free THEN
        SELECT id INTO v_adopted_plan_id
        FROM "Plan"
        WHERE UPPER(name) IN ('FREE', 'FREE PLAN', 'DEFAULT')
        ORDER BY "createdAt" ASC
        LIMIT 1;

        IF v_adopted_plan_id IS NOT NULL THEN
            -- Adopt the legacy plan without mutating its ID, name, limits, or pricing
            UPDATE "Plan"
            SET "code" = 'FREE'
            WHERE id = v_adopted_plan_id;
        ELSE
            -- Neither code = 'FREE' nor legacy Free plan exists; insert the canonical baseline
            INSERT INTO "Plan" (
                "id", "code", "name", "description", "isActive", "isPublic", 
                "sortOrder", "currency", "price", "priceMonthly", "priceYearly", 
                "maxBranches", "maxStaff", "maxProducts", "maxTransactions", 
                "features", "createdAt", "updatedAt"
            )
            VALUES (
                gen_random_uuid()::text, 'FREE', 'Free Plan', 'Foundational tier for small businesses',
                true, true, 0, 'BDT', 0.0000, 0.0000, 0.0000,
                1, 2, 100, 500, '{"reports": "BASIC"}'::jsonb, NOW(), NOW()
            );
        END IF;
    END IF;

    -- 3. Assert invariant: exactly 1 canonical Free Plan must exist
    SELECT COUNT(*) INTO v_free_count FROM "Plan" WHERE "code" = 'FREE';
    IF v_free_count <> 1 THEN
        RAISE EXCEPTION 'MIGRATION ABORTED: Expected exactly 1 plan with code = FREE, found %', v_free_count;
    END IF;
END $$;

-- AlterTable Subscription (Stage 1: Add as Nullable)
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "currentPeriodEnd" TIMESTAMP(3);
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "currentPeriodStart" TIMESTAMP(3);
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "gracePeriodEndsAt" TIMESTAMP(3);
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "pendingPlanId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "provider" TEXT;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "providerSubscriptionId" TEXT;
ALTER TABLE "Subscription" ALTER COLUMN "startDate" SET DEFAULT CURRENT_TIMESTAMP;

-- Subscription Period Backfill (Stage 2: Preserves valid historical values)
UPDATE "Subscription"
SET 
    "currentPeriodStart" = "startDate",
    "currentPeriodEnd" = CASE
        WHEN "endDate" IS NOT NULL AND "endDate" > "startDate" THEN "endDate"
        WHEN "status" = 'TRIAL' AND "trialEndsAt" IS NOT NULL AND "trialEndsAt" > "startDate" THEN "trialEndsAt"
        WHEN "billingCycle" = 'YEARLY' THEN "startDate" + INTERVAL '1 year'
        ELSE "startDate" + INTERVAL '1 month'
    END
WHERE "currentPeriodStart" IS NULL OR "currentPeriodEnd" IS NULL;

-- Subscription Period Audit (Stage 3: Abort if missing or inverted)
DO $$
DECLARE
    v_missing_start INTEGER;
    v_missing_end INTEGER;
    v_inverted_dates INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_missing_start FROM "Subscription" WHERE "currentPeriodStart" IS NULL;
    SELECT COUNT(*) INTO v_missing_end FROM "Subscription" WHERE "currentPeriodEnd" IS NULL;
    SELECT COUNT(*) INTO v_inverted_dates FROM "Subscription" WHERE "currentPeriodEnd" <= "currentPeriodStart";

    IF v_missing_start > 0 OR v_missing_end > 0 OR v_inverted_dates > 0 THEN
        RAISE EXCEPTION 'MIGRATION ABORTED: Inconsistent subscription periods detected (missing_start: %, missing_end: %, inverted: %)', 
            v_missing_start, v_missing_end, v_inverted_dates;
    END IF;
END $$;

-- Stage 4: Enforce NOT NULL on Subscription period columns
ALTER TABLE "Subscription" ALTER COLUMN "currentPeriodStart" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Subscription" ALTER COLUMN "currentPeriodStart" SET NOT NULL;
ALTER TABLE "Subscription" ALTER COLUMN "currentPeriodEnd" SET NOT NULL;

-- Backfill legacy organizations with canonical Free plan
INSERT INTO "Subscription" (
    "id", "organizationId", "planId", "status", "billingCycle", "startDate",
    "currentPeriodStart", "currentPeriodEnd", "cancelAtPeriodEnd", "provider", "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    o.id,
    (SELECT id FROM "Plan" WHERE "code" = 'FREE' LIMIT 1),
    'ACTIVE',
    'MONTHLY',
    o."createdAt",
    date_trunc('month', NOW()),
    date_trunc('month', NOW()) + INTERVAL '1 month',
    false,
    'INTERNAL_SYSTEM',
    NOW(),
    NOW()
FROM "Organization" o
WHERE NOT EXISTS (
    SELECT 1 FROM "Subscription" s WHERE s."organizationId" = o.id
);

-- Indexes on Subscription
CREATE INDEX IF NOT EXISTS "Subscription_organizationId_status_idx" ON "Subscription"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "Subscription_status_currentPeriodEnd_idx" ON "Subscription"("status", "currentPeriodEnd");

-- Partial Unique Index (Includes SUSPENDED)
CREATE UNIQUE INDEX IF NOT EXISTS "idx_unique_effective_subscription_per_org" 
ON "Subscription" ("organizationId") 
WHERE "status" IN ('ACTIVE', 'TRIAL', 'PAST_DUE', 'SUSPENDED');

-- CreateTable SubscriptionBillingRecord
CREATE TABLE IF NOT EXISTS "SubscriptionBillingRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "billingCycle" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "BillingRecordStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "provider" TEXT,
    "transactionId" TEXT,
    "idempotencyKey" TEXT,
    "rawProviderPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionBillingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable SubscriptionWebhookEvent
CREATE TABLE IF NOT EXISTS "SubscriptionWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "providerTxnId" TEXT,
    "eventType" TEXT NOT NULL,
    "organizationId" TEXT,
    "subscriptionId" TEXT,
    "billingRecordId" TEXT,
    "payload" JSONB NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "eventTimestamp" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- Indexes and Constraints for Billing and WebhookEvent
CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionBillingRecord_invoiceNumber_key" ON "SubscriptionBillingRecord"("invoiceNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionBillingRecord_idempotencyKey_key" ON "SubscriptionBillingRecord"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "SubscriptionBillingRecord_organizationId_createdAt_idx" ON "SubscriptionBillingRecord"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "SubscriptionBillingRecord_status_idx" ON "SubscriptionBillingRecord"("status");

CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionWebhookEvent_provider_providerEventId_key" ON "SubscriptionWebhookEvent"("provider", "providerEventId");
CREATE INDEX IF NOT EXISTS "SubscriptionWebhookEvent_status_leaseExpiresAt_idx" ON "SubscriptionWebhookEvent"("status", "leaseExpiresAt");
CREATE INDEX IF NOT EXISTS "SubscriptionWebhookEvent_providerTxnId_idx" ON "SubscriptionWebhookEvent"("providerTxnId");
CREATE INDEX IF NOT EXISTS "SubscriptionWebhookEvent_subscriptionId_idx" ON "SubscriptionWebhookEvent"("subscriptionId");

-- Audit Retention Foreign Keys
DO $$ BEGIN
    ALTER TABLE "SubscriptionBillingRecord" ADD CONSTRAINT "SubscriptionBillingRecord_organizationId_fkey" 
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "SubscriptionBillingRecord" ADD CONSTRAINT "SubscriptionBillingRecord_subscriptionId_fkey" 
    FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE "SubscriptionWebhookEvent" ADD CONSTRAINT "SubscriptionWebhookEvent_organizationId_fkey" 
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
