import { PrismaClient } from "@prisma/client";

/**
 * One Prisma client per process. Next.js dev mode hot-reloads modules, so the
 * instance is cached on `globalThis` to avoid exhausting SQLite connections.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["error"] : ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
