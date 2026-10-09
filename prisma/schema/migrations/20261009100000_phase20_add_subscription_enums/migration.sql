-- Phase 20 Step 1: Add Subscription Enums

-- AlterEnum
ALTER TYPE "SubscriptionStatus" ADD VALUE 'SUSPENDED';

-- CreateEnum
CREATE TYPE "BillingRecordStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED');
