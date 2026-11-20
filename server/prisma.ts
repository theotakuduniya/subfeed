import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  __minisocialPrisma?: PrismaClient;
};

export function isDatabaseConfigured(): boolean {
  const url = (process.env.DATABASE_URL || '').trim();
  return url.length > 0 && /^postgres(ql)?:\/\//i.test(url);
}

export function getPrisma(): PrismaClient | null {
  if (!isDatabaseConfigured()) {
    return null;
  }

  if (!globalForPrisma.__minisocialPrisma) {
    globalForPrisma.__minisocialPrisma = new PrismaClient({
      log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
    });
  }

  return globalForPrisma.__minisocialPrisma;
}
