import {PrismaClient} from '@prisma/client';

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SEED !== '1') {
  console.error('Refusing to seed demo history in production (set ALLOW_SEED=1 to override).');
  process.exit(1);
}

const p = new PrismaClient();
const uid = '00000000-0000-0000-0000-000000000001';
const TAG = 'demo-history';

/** Small deterministic PRNG so repeated runs produce stable sample data. */
let seed = 20261002;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T>(items: readonly T[]) => items[Math.floor(rnd() * items.length)];
const between = (min: number, max: number) => Math.round(min + rnd() * (max - min));

type Row = {
  date: Date;
  description: string;
  amount: number;
  type: 'NEED' | 'WANT' | 'INCOME';
  paymentMethod: 'UPI' | 'CREDIT_CARD' | 'CASH' | 'DEBIT_CARD' | 'BANK_TRANSFER';
  creditCardId?: string;
};

async function main() {
  const clear = process.argv.includes('--clear');
  if (clear) {
    const removed = await p.expense.deleteMany({where: {userId: uid, notes: TAG}});
    console.log(`Removed ${removed.count} demo-history transactions`);
    return;
  }
  const total = await p.expense.count({where: {userId: uid}});
  if (total >= 10) {
    console.log(`Ledger already has ${total} transactions — refusing to add demo history. Use --clear first.`);
    return;
  }

  await p.category.upsert({
    where: {userId_name: {userId: uid, name: 'Income'}},
    update: {},
    create: {userId: uid, name: 'Income', monthlyBudget: 0, colorCode: '#0ea5e9'},
  });
  await p.category.updateMany({where: {userId: uid, name: {in: ['Rent', 'Health']}}, data: {taxDeductible: true}});
  const categories = await p.category.findMany({where: {userId: uid}});
  const byName = new Map(categories.map((c) => [c.name, c.id]));
  const card = await p.creditCard.findFirst({where: {userId: uid, id: '00000000-0000-0000-0000-000000000101'}});
  if (card) {
    await p.creditCard.update({where: {id: card.id}, data: {apr: 42, rewardsRate: 1.5}});
  }

  const need = (name: string) => {
    const id = byName.get(name);
    if (!id) throw new Error(`missing category ${name}`);
    return id;
  };

  const now = new Date();
  const rows: (Row & {categoryId: string})[] = [];
  const cardId = card?.id;

  for (let back = 5; back >= 0; back--) {
    const base = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    const lastDay = back === 0 ? now.getDate() : daysInMonth;
    const randDay = () => between(1, daysInMonth);
    const push = (day: number, row: Row & {category: string}) => {
      if (day > lastDay) return;
      const {category, ...rest} = row;
      rows.push({...rest, date: new Date(base.getFullYear(), base.getMonth(), day), categoryId: need(category)});
    };

    push(1, {date: base, description: 'Monthly salary credit', amount: 65000, type: 'INCOME', paymentMethod: 'BANK_TRANSFER', category: 'Income'});
    push(3, {date: base, description: 'Apartment rent', amount: 18000, type: 'NEED', paymentMethod: 'BANK_TRANSFER', category: 'Rent'});
    push(5, {date: base, description: 'Electricity bill', amount: between(1100, 2400), type: 'NEED', paymentMethod: 'UPI', category: 'Bills & Utilities'});
    push(7, {date: base, description: 'Broadband internet', amount: 999, type: 'NEED', paymentMethod: 'CREDIT_CARD', creditCardId: cardId, category: 'Bills & Utilities'});
    push(9, {date: base, description: 'Mobile recharge', amount: between(239, 399), type: 'NEED', paymentMethod: 'UPI', category: 'Bills & Utilities'});

    push(2, {date: base, description: 'Netflix plan', amount: 649, type: 'WANT', paymentMethod: 'CREDIT_CARD', creditCardId: cardId, category: 'Subscriptions'});
    push(4, {date: base, description: 'Spotify Premium', amount: 119, type: 'WANT', paymentMethod: 'CREDIT_CARD', creditCardId: cardId, category: 'Subscriptions'});
    push(11, {date: base, description: 'Amazon Prime', amount: 149, type: 'WANT', paymentMethod: 'CREDIT_CARD', creditCardId: cardId, category: 'Subscriptions'});
    push(14, {date: base, description: 'iCloud storage', amount: 219, type: 'NEED', paymentMethod: 'CREDIT_CARD', creditCardId: cardId, category: 'Subscriptions'});
    push(16, {date: base, description: 'Gym membership', amount: 1500, type: 'NEED', paymentMethod: 'CREDIT_CARD', creditCardId: cardId, category: 'Health'});

    for (let i = 0; i < 6; i++) {
      push(randDay(), {
        date: base,
        description: pick(['Groceries', 'Vegetables & fruits', 'Weekly market run']),
        amount: between(620, 2400),
        type: 'NEED',
        paymentMethod: pick(['UPI', 'CREDIT_CARD'] as const),
        creditCardId: rnd() > 0.5 ? cardId : undefined,
        category: 'Food',
      });
    }
    for (let i = 0; i < 14; i++) {
      push(randDay(), {
        date: base,
        description: pick(['Lunch', 'Dinner', 'Breakfast', 'Coffee', 'Tea & snacks', 'Swiggy order']),
        amount: between(90, 680),
        type: rnd() > 0.6 ? 'WANT' : 'NEED',
        paymentMethod: pick(['UPI', 'CASH', 'CREDIT_CARD'] as const),
        creditCardId: rnd() > 0.7 ? cardId : undefined,
        category: 'Food',
      });
    }
    for (let i = 0; i < 7; i++) {
      push(randDay(), {
        date: base,
        description: pick(['Cab ride', 'Petrol', 'Metro recharge', 'Auto ride']),
        amount: between(120, 1400),
        type: 'NEED',
        paymentMethod: pick(['UPI', 'CREDIT_CARD', 'CASH'] as const),
        creditCardId: rnd() > 0.6 ? cardId : undefined,
        category: 'Transport',
      });
    }
    for (let i = 0; i < 3; i++) {
      push(randDay(), {
        date: base,
        description: pick(['Amazon order', 'Myntra order', 'Decathlon', 'Home supplies']),
        amount: between(650, 5200),
        type: 'WANT',
        paymentMethod: 'CREDIT_CARD',
        creditCardId: cardId,
        category: 'Shopping',
      });
    }
    for (let i = 0; i < 2; i++) {
      push(randDay(), {
        date: base,
        description: pick(['Pharmacy', 'Doctor consult', 'Physio session']),
        amount: between(300, 2200),
        type: 'NEED',
        paymentMethod: pick(['UPI', 'CREDIT_CARD'] as const),
        creditCardId: rnd() > 0.5 ? cardId : undefined,
        category: 'Health',
      });
    }
    if (rnd() > 0.45) {
      push(randDay(), {
        date: base,
        description: pick(['Movie tickets', 'Weekend outing', 'Birthday gift', 'Concert tickets']),
        amount: between(500, 3500),
        type: 'WANT',
        paymentMethod: 'CREDIT_CARD',
        creditCardId: cardId,
        category: 'Shopping',
      });
    }
  }

  for (const row of rows) {
    await p.expense.create({
      data: {
        userId: uid,
        date: row.date,
        categoryId: row.categoryId,
        description: row.description,
        paymentMethod: row.paymentMethod,
        creditCardId: row.paymentMethod === 'CREDIT_CARD' ? (row.creditCardId ?? cardId ?? null) : null,
        amount: row.amount,
        type: row.type,
        myShare: row.amount,
        notes: TAG,
      },
    });
  }
  console.log(`Seeded ${rows.length} demo-history transactions across the last 6 months`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());
