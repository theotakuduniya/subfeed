import 'dotenv/config';
import { spawnSync } from 'child_process';

const databaseUrl = (process.env.DATABASE_URL || '').trim();

if (!databaseUrl) {
  console.log(
    '[minisocial] DATABASE_URL is not set — skipping `prisma db push`. Add DATABASE_URL in Render Environment Variables to sync your PostgreSQL tables.'
  );
  process.exit(0);
}

console.log('[minisocial] Pushing Prisma schema to PostgreSQL...');
const result = spawnSync('npx', ['prisma', 'db', 'push', '--skip-generate'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
