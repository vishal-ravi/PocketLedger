import {round2} from '@/lib/analytics';

export type AccountRow = {
  id: string;
  name: string;
  type: string;
  balance: unknown;
  createdAt?: Date;
};

export type CardDueRow = {id: string; cardName: string; dues: number};
export type LoanDueRow = {id: string; lenderName: string; outstanding: number};

export type NetWorth = {
  assets: number;
  cardDues: number;
  loanOutstanding: number;
  liabilities: number;
  netWorth: number;
};

export function toAccountDto(row: AccountRow) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    balance: Number(row.balance),
    createdAt: row.createdAt,
  };
}

/** Assets (bank/cash/wallet balances) minus what you owe on cards and loans. */
export function computeNetWorth(accounts: AccountRow[], cards: CardDueRow[], loans: LoanDueRow[]): NetWorth {
  const assets = round2(accounts.reduce((sum, row) => sum + Number(row.balance), 0));
  const cardDues = round2(cards.reduce((sum, row) => sum + row.dues, 0));
  const loanOutstanding = round2(loans.reduce((sum, row) => sum + row.outstanding, 0));
  const liabilities = round2(cardDues + loanOutstanding);
  return {assets, cardDues, loanOutstanding, liabilities, netWorth: round2(assets - liabilities)};
}

/** Unspent budget carried into the current month. Overspending never carries a negative budget. */
export function rolloverAmount(monthlyBudget: number, previousSpend: number): number {
  if (monthlyBudget <= 0) return 0;
  return round2(Math.max(0, monthlyBudget - previousSpend));
}
