import "dotenv/config.js";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema",
  datasource: {
    url: env("DATABASE_URL"),
  },
  migrations: {
    seed: 'npx tsx ./prisma/seed.ts',
  },
});
