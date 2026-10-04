import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {PrismaClient} from '@prisma/client';

const prisma = new PrismaClient();

type Table = {
  name: string;
  count: () => Promise<number>;
  clear: () => Promise<{count: number}>;
  restore: (rows: Record<string, unknown>[]) => Promise<void>;
};

/** Parents before children (FK-safe). The clear pass runs this list in reverse. */
const TABLES: Table[] = [
  {
    name: 'user',
    count: () => prisma.user.count(),
    clear: () => prisma.user.deleteMany(),
    restore: async (rows) => {
      for (const row of rows) await prisma.user.create({data: row as never});
    },
  },
  {
    name: 'category',
    count: () => prisma.category.count(),
    clear: () => prisma.category.deleteMany(),
    restore: async (rows) => {
      for (const row of rows) await prisma.category.create({data: row as never});
    },
  },
  {
    name: 'creditCard',
    count: () => prisma.creditCard.count(),
    clear: () => prisma.creditCard.deleteMany(),
    restore: async (rows) => {
      for (const row of rows) await prisma.creditCard.create({data: row as never});
    },
  },
  {
    name: 'expense',
    count: () => prisma.expense.count(),
    clear: () => prisma.expense.deleteMany(),
    restore: async (rows) => {
      for (const row of rows) await prisma.expense.create({data: row as never});
    },
  },
  {
    name: 'splitDetail',
    count: () => prisma.splitDetail.count(),
    clear: () => prisma.splitDetail.deleteMany(),
    restore: async (rows) => {
      for (const row of rows) await prisma.splitDetail.create({data: row as never});
    },
  },
  {
    name: 'goal',
    count: () => prisma.goal.count(),
    clear: () => prisma.goal.deleteMany(),
    restore: async (rows) => {
      for (const row of rows) await prisma.goal.create({data: row as never});
    },
  },
  {
    name: 'loan',
    count: () => prisma.loan.count(),
    clear: () => prisma.loan.deleteMany(),
    restore: async (rows) => {
      for (const row of rows) await prisma.loan.create({data: row as never});
    },
  },
  {
    name: 'loanInstallment',
    count: () => prisma.loanInstallment.count(),
    clear: () => prisma.loanInstallment.deleteMany(),
    restore: async (rows) => {
      for (const row of rows) await prisma.loanInstallment.create({data: row as never});
    },
  },
  {
    name: 'debtRepayment',
    count: () => prisma.debtRepayment.count(),
    clear: () => prisma.debtRepayment.deleteMany(),
    restore: async (rows) => {
      for (const row of rows) await prisma.debtRepayment.create({data: row as never});
    },
  },
  {
    name: 'authToken',
    count: () => prisma.authToken.count(),
    clear: () => prisma.authToken.deleteMany(),
    restore: async (rows) => {
      for (const row of rows) await prisma.authToken.create({data: row as never});
    },
  },
];

async function load(dir: string, name: string): Promise<Record<string, unknown>[]> {
  try {
    return JSON.parse(await readFile(path.join(dir, `${name}.json`), 'utf8'));
  } catch {
    return [];
  }
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const dir = args.find((a) => !a.startsWith('--'));
  if (!dir) {
    console.error('Usage: npm run db:restore -- <backup-dir> [--force]');
    process.exitCode = 1;
    return;
  }

  const existing = (await Promise.all(TABLES.map((t) => t.count()))).reduce((a, b) => a + b, 0);
  if (existing > 0 && !force) {
    console.error(`Refusing to restore: ${existing} rows already exist. Re-run with --force to overwrite.`);
    process.exitCode = 1;
    return;
  }

  // Clear children first (reverse of restore order).
  for (const table of [...TABLES].reverse()) {
    if ((await table.count()) > 0) await table.clear();
  }

  let total = 0;
  for (const table of TABLES) {
    const rows = await load(dir, table.name);
    if (rows.length) await table.restore(rows);
    total += rows.length;
    if (rows.length) console.log(`  ${table.name}: ${rows.length}`);
  }
  console.log(`Restored ${total} rows from ${dir}`);
}

main()
  .catch((err) => {
    console.error('Restore failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
