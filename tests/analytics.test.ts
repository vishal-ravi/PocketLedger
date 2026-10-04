import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  bandFor,
  billingCycle,
  daysBetween,
  detectSubscriptions,
  isoDay,
  monthBuckets,
  nextOccurrence,
  normalizeDescription,
  parseDay,
  projectMonth,
  round2,
  summarize,
  weekdayIndex,
} from '../lib/analytics';

test('round2 rounds to 2 decimals', () => {
  assert.equal(round2(10.005), 10.01);
  assert.equal(round2(10.004), 10);
  assert.equal(round2(-3.14159), -3.14);
});

test('billingCycle spans statement day to statement day', () => {
  const cycle = billingCycle(18, new Date(2026, 9, 25)); // 25 Oct, statement day 18
  assert.equal(cycle.start.getDate(), 18);
  assert.equal(cycle.start.getMonth(), 9); // previous statement was 18 Oct? current month start 18 Oct <= today
  assert.equal(cycle.end.getDate(), 18);
  assert.equal(cycle.start.getMonth() + 1, cycle.end.getMonth());
  assert.equal(cycle.totalDays, 31); // 18 Oct → 18 Nov
  assert.equal(cycle.elapsed, 7); // 18 → 25 Oct
  assert.equal(cycle.daysLeft, 24);
});

test('billingCycle rolls back when statement day is still ahead this month', () => {
  const cycle = billingCycle(28, new Date(2026, 9, 5)); // 5 Oct, statement day 28
  assert.equal(cycle.start.getMonth(), 8); // 28 Sep
  assert.equal(cycle.end.getMonth(), 9); // 28 Oct
  assert.ok(cycle.daysLeft > 0);
});

test('monthBuckets returns N ascending buckets ending this month', () => {
  const buckets = monthBuckets(3, new Date(2026, 9, 10));
  assert.equal(buckets.length, 3);
  assert.equal(buckets[2].key, '2026-10');
  assert.equal(buckets[0].key, '2026-08');
  assert.ok(buckets[0].start < buckets[1].start && buckets[1].start < buckets[2].start);
});

test('daysBetween / parseDay / isoDay', () => {
  assert.equal(daysBetween(new Date(2026, 0, 1), new Date(2026, 0, 31)), 30);
  assert.equal(daysBetween(new Date(2026, 0, 31), new Date(2026, 0, 1)), 1); // clamps to >= 1
  assert.equal(parseDay('2026-10-05')?.getDate(), 5);
  assert.equal(parseDay('2026-13-40'), null);
  assert.equal(parseDay('nonsense'), null);
  assert.equal(parseDay(null), null);
  assert.equal(isoDay(new Date(2026, 0, 5)), '2026-01-05');
});

test('nextOccurrence finds the next day-of-month', () => {
  const from = new Date(2026, 9, 5);
  assert.equal(nextOccurrence(20, from).getTime(), new Date(2026, 9, 20).getTime());
  const later = new Date(2026, 9, 25);
  assert.equal(nextOccurrence(20, later).getTime(), new Date(2026, 10, 20).getTime());
  // clamped when the target month is shorter than the requested day
  const feb = new Date(2027, 1, 1);
  assert.equal(nextOccurrence(31, feb).getDate(), 28);
});

test('weekdayIndex is Monday-based', () => {
  assert.equal(weekdayIndex(new Date(2026, 9, 5)), 0); // Monday
  assert.equal(weekdayIndex(new Date(2026, 9, 11)), 6); // Sunday
});

test('normalizeDescription strips amounts and punctuation', () => {
  assert.equal(normalizeDescription('Netflix ₹149'), 'netflix');
  assert.equal(normalizeDescription('netflix 149'), 'netflix');
  assert.equal(normalizeDescription('  SPOTIFY!! '), 'spotify');
  assert.equal(normalizeDescription('Coffee with milk'), 'coffee with milk');
});

test('bandFor maps utilisation to bands', () => {
  assert.equal(bandFor(0), 'excellent');
  assert.equal(bandFor(30), 'excellent');
  assert.equal(bandFor(31), 'good');
  assert.equal(bandFor(75), 'fair');
  assert.equal(bandFor(76), 'high');
});

test('projectMonth prefers trailing-30-day run rate', () => {
  assert.equal(projectMonth(3000, 1000, 5, 31), round2((3000 / 30) * 31));
  assert.equal(projectMonth(0, 1000, 10, 31), round2(100 * 31));
  assert.equal(projectMonth(0, 0, 0, 31), 0);
});

test('summarize computes income, spend and top category', () => {
  const s = summarize(
    [
      {type: 'INCOME', amount: 1000, category: 'Salary'},
      {type: 'NEED', amount: 300, category: 'Food'},
      {type: 'WANT', amount: 200, category: 'Fun'},
      {type: 'NEED', amount: 100, category: 'Food'},
    ],
    10,
  );
  assert.equal(s.income, 1000);
  assert.equal(s.expenses, 600);
  assert.equal(s.savings, 400);
  assert.equal(s.savingsRate, 40);
  assert.equal(s.dailyAverage, 60);
  assert.equal(s.topCategory, 'Food');
});

test('detectSubscriptions finds a stable monthly charge', () => {
  const now = new Date(2026, 9, 10);
  const rows = [
    {date: new Date(2026, 5, 12), amount: 149, description: 'Netflix', categoryId: 'c1'},
    {date: new Date(2026, 6, 12), amount: 149, description: 'Netflix', categoryId: 'c1'},
    {date: new Date(2026, 7, 12), amount: 149, description: 'Netflix', categoryId: 'c1'},
    {date: new Date(2026, 8, 12), amount: 159, description: 'Netflix', categoryId: 'c1'},
  ];
  const subs = detectSubscriptions(rows, now);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].name, 'Netflix');
  assert.equal(subs[0].occurrences, 4);
  assert.equal(subs[0].gapDays, 31);
  assert.ok(subs[0].amount >= 149 && subs[0].amount <= 159);
});

test('detectSubscriptions ignores one-off charges', () => {
  const rows = [
    {date: new Date(2026, 5, 1), amount: 999, description: 'Laptop', categoryId: 'c1'},
    {date: new Date(2026, 6, 1), amount: 50, description: 'Groceries', categoryId: 'c2'},
  ];
  assert.equal(detectSubscriptions(rows, new Date(2026, 9, 10)).length, 0);
});
