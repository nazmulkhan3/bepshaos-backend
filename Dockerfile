# ---------------------------------------------------------
# BebshaOS Backend - Production Multi-Stage Dockerfile
# ---------------------------------------------------------

# Stage 1: Build & Dependencies
FROM node:24-alpine AS builder

WORKDIR /app

# Install pnpm and native build dependencies (for argon2, etc.)
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN apk add --no-cache python3 make g++ libc6-compat

# Copy package management files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* .npmrc ./

# Install all dependencies (including devDependencies for build and prisma generate)
RUN pnpm install --frozen-lockfile

# Copy source, prisma schema and configurations
COPY tsconfig*.json nest-cli.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src

# Generate Prisma Client
RUN pnpm prisma generate

# Build NestJS production bundle
RUN pnpm build

# Prune development dependencies to keep production node_modules minimal
RUN pnpm prune --prod

# ---------------------------------------------------------
# Stage 2: Production Runner
# ---------------------------------------------------------
FROM node:24-alpine AS runner

WORKDIR /app

# Ensure security: run as non-root user (node user is built into node-alpine, uid:gid 1000:1000)
# Install curl or wget for healthcheck if needed
RUN apk add --no-cache curl libc6-compat dumb-init

ENV NODE_ENV=production
ENV PORT=3000

# Copy dumb-init for proper PID 1 signal forwarding and graceful shutdown
# Copy production node_modules from builder
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
# Copy built dist files
COPY --from=builder --chown=node:node /app/dist ./dist
# Copy prisma schema and configs needed by runtime
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=node:node /app/package.json ./package.json

USER node

EXPOSE 3000

# Container Healthcheck using NestJS /api/v1/health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/api/v1/health || exit 1

# dumb-init handles SIGTERM/SIGINT and forwards to node for NestJS enableShutdownHooks()
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/main.js"]
