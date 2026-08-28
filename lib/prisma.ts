import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

// Next's dev server hot-reloads modules on every save. Without stashing the
// client on globalThis, each reload would construct a fresh PrismaClient with a
// fresh connection pool and quickly exhaust Supabase's connection limit.
// The global survives hot reloads; production builds create exactly one client.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  // Prisma 7 requires a driver adapter — `new PrismaClient()` alone throws.
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  });

  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
