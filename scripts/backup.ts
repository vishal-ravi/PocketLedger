import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {PrismaClient} from '@prisma/client';

const prisma = new PrismaClient();

/** FK-safe order for restore (parents before children). */
const TABLES: {name: string; all: () => Promise<unknown[]>}[] = [
  {name: 'user', all: () => prisma.user.findMany()},
  {name: 'category', all: () => prisma.category.findMany()},
  {name: 'creditCard', all: () => prisma.creditCard.findMany()},
  {name: 'expense', all: () => prisma.expense.findMany()},
  {name: 'goal', all: () => prisma.goal.findMany()},
  {name: 'splitDetail', all: () => prisma.splitDetail.findMany()},
  {name: 'loan', all: () => prisma.loan.findMany()},
  {name: 'loanInstallment', all: () => prisma.loanInstallment.findMany()},
  {name: 'debtRepayment', all: () => prisma.debtRepayment.findMany()},
  {name: 'authToken', all: () => prisma.authToken.findMany()},
];

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = process.argv[2] ?? path.join(process.cwd(), 'backups', stamp);
  await mkdir(dir, {recursive: true});

  const counts: Record<string, number> = {};
  for (const table of TABLES) {
    const rows = await table.all();
    counts[table.name] = rows.length;
    await writeFile(path.join(dir, `${table.name}.json`), JSON.stringify(rows, null, 1), 'utf8');
  }

  const manifest = {
    exportedAt: new Date().toISOString(),
    tables: TABLES.map((t) => t.name),
    counts,
    restore: 'npm run db:restore -- <dir> --force',
  };
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  console.log(`Backed up ${total} rows across ${TABLES.length} tables → ${dir}`);
}

main()
  .catch((err) => {
    console.error('Backup failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
