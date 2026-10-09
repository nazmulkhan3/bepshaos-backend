# BebshaOS Backend

BebshaOS is a multi-tenant business operating system for small and medium businesses.

This repository contains the backend API foundation for BebshaOS, built with NestJS.

## Technology Stack

* **Framework**: NestJS
* **Language**: TypeScript
* **Database**: PostgreSQL (via Prisma ORM)
* **Caching & Queues**: Redis & BullMQ
* **Documentation**: Swagger / OpenAPI
* **Containerization**: Docker
* **Package Manager**: pnpm

## Project Structure

```text
src/
├── common/        # Global filters, decorators, utilities (e.g., logger, exceptions)
├── config/        # Environment configurations
├── database/      # Prisma module and service for DB connectivity
├── infrastructure/# External infrastructure (Redis, BullMQ)
├── modules/       # Application features (e.g., health check)
├── app.module.ts  # Root application module
└── main.ts        # Entry point and global configuration setup
```

## Prerequisites

* [Node.js](https://nodejs.org/) (v18+)
* [pnpm](https://pnpm.io/)
* [Docker](https://www.docker.com/)

## Environment Setup

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Review the values in `.env` and adjust if necessary.

## Docker Setup

To start the local PostgreSQL and Redis services, run:

```bash
docker-compose up -d
```

## Local Development

Install dependencies:

```bash
pnpm install
```

Generate Prisma Client:

```bash
pnpm run prisma:generate
```

Start the application in development mode:

```bash
pnpm run dev
```

## Prisma Commands

* **Generate Client**: `pnpm run prisma:generate`
* **Validate Schema**: `pnpm run prisma:validate`

*(Note: Database migrations and business models will be implemented in Phase 02)*

## API Documentation

Swagger UI is available at:
[http://localhost:3000/api/docs](http://localhost:3000/api/docs)

## Health Endpoint

Check the application health at:
[http://localhost:3000/api/v1/health](http://localhost:3000/api/v1/health)
