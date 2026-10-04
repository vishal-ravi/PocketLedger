import type {Prisma} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {round2} from '@/lib/analytics';

export type PendingSplitRow = {
  personName: string;
  amountOwedToMe: unknown;
  amountIOwe: unknown;
  status: string;
  expense?: {date: Date};
};

export type PersonBalance = {name: string; owed: number; owe: number; balance: number};

/** Aggregates pending split rows into per-person receivables / payables. */
export function splitTotals(rows: PendingSplitRow[]) {
  let receivable = 0;
  let payable = 0;
  const map = new Map<string, {owed: number; owe: number}>();

  for (const row of rows) {
    const owed = Number(row.amountOwedToMe);
    const owe = Number(row.amountIOwe);
    receivable += owed;
    payable += owe;
    const entry = map.get(row.personName) ?? {owed: 0, owe: 0};
    entry.owed += owed;
    entry.owe += owe;
    map.set(row.personName, entry);
  }

  const people: PersonBalance[] = [...map.entries()]
    .map(([name, entry]) => ({
      name,
      owed: round2(entry.owed),
      owe: round2(entry.owe),
      balance: round2(entry.owed - entry.owe),
    }))
    .filter((person) => person.balance !== 0)
    .sort((a, b) => b.balance - a.balance);

  return {receivable: round2(receivable), payable: round2(payable), people};
}

export async function pendingSplits(memberIds: string[]) {
  return prisma.splitDetail.findMany({
    where: {status: 'PENDING', expense: {userId: {in: memberIds}}},
    include: {expense: {select: {date: true}}},
    orderBy: {expense: {date: 'asc'}},
  });
}

type Db = Prisma.TransactionClient | typeof prisma;

/** Creates a ledger category if the user does not have one with this name yet. */
export async function ensureCategory(db: Db, userId: string, memberIds: string[], name: string, colorCode: string) {
  const existing = await db.category.findFirst({where: {userId: {in: memberIds}, name}});
  if (existing) return existing;
  return db.category.create({data: {userId, name, monthlyBudget: 0, colorCode}});
}
