import type {NetWorth} from '@/lib/networth';
export type Summary = {
  income: number;
  expenses: number;
  savings: number;
  savingsRate: number;
  dailyAverage: number;
  needs: number;
  wants: number;
  topCategory: string;
};

export type BudgetBlock = {
  budget: number;
  rollover: number;
  available: number;
  spent: number;
  projected: number;
  pct: number;
  remaining: number;
  perDay: number;
  daysLeft: number;
  daysInMonth: number;
  elapsed: number;
  status: 'no-budget' | 'over' | 'watch' | 'on-track';
};

export type AnomalyBlock = {
  flagged: boolean;
  pacePct: number;
  expected: number;
  actual: number;
  usualDaily: number;
  message: string;
};

export type StreakBlock = {
  noSpendDays: number;
  underBudgetDays: number;
  daysLogged: number;
  daysInMonth: number;
  daysLeft: number;
};

export type UpcomingCard = {
  id: string;
  cardName: string;
  dueDate: string;
  daysToDue: number;
  projectedBill: number;
  statementDate: string;
  daysToStatement: number;
};

export type UpcomingSubscription = {
  name: string;
  amount: number;
  nextDue: string;
  daysToDue: number;
  overdue: boolean;
};

export type UpcomingRecurring = {
  id: string;
  description: string;
  amount: number;
  nextDue: string;
  daysToDue: number;
  interval: string;
  autoPost: boolean;
  overdue: boolean;
};

export type SplitBlock = {
  receivable: number;
  payable: number;
  people: {name: string; balance: number}[];
};

export type PaymentMixRow = {method: string; label: string; amount: number; count: number};

export type TopCategoryRow = {id: string; name: string; color: string; amount: number};

export type RecentRow = {
  id: string;
  description: string;
  amount: number;
  date: string;
  type: string;
  method: string;
  category: string;
  color: string;
};

export type EmiRow = {
  loanId: string;
  lenderName: string;
  number: number;
  dueDate: string;
  daysToDue: number;
  amount: number;
};

export type LoanBlock = {count: number; outstanding: number; monthly: number; overdue: number};

export type DashboardData = {
  summary: Summary;
  budget: BudgetBlock;
  anomaly: AnomalyBlock;
  streaks: StreakBlock;
  upcoming: {cards: UpcomingCard[]; subscriptions: UpcomingSubscription[]; recurring: UpcomingRecurring[]};
  netWorth: NetWorth;
  splits: SplitBlock;
  paymentMix: PaymentMixRow[];
  topCategories: TopCategoryRow[];
  recent: RecentRow[];
  emis: EmiRow[];
  loans: LoanBlock;
  today: string;
};
