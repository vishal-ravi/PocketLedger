import {test} from 'node:test';
import assert from 'node:assert/strict';
import {addInterval, catchUp, dateKey, formatInterval, toRecurringDto, todayKey} from '../lib/recurring';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

test('addInterval: weekly adds exactly seven days', () => {
  assert.equal(dateKey(addInterval(d('2026-10-01'), 'WEEKLY')), '2026-10-08');
  assert.equal(dateKey(addInterval(d('2026-12-29'), 'WEEKLY')), '2027-01-05');
});

test('addInterval: monthly keeps the day, clamped to the target month', () => {
  assert.equal(dateKey(addInterval(d('2026-01-31'), 'MONTHLY')), '2026-02-28');
  assert.equal(dateKey(addInterval(d('2026-01-31'), 'MONTHLY')), '2026-02-28');
  assert.equal(dateKey(addInterval(d('2026-03-31'), 'MONTHLY')), '2026-04-30');
  assert.equal(dateKey(addInterval(d('2026-05-15'), 'MONTHLY')), '2026-06-15');
});

test('addInterval: yearly clamps leap-day anniversaries', () => {
  assert.equal(dateKey(addInterval(d('2028-02-29'), 'YEARLY')), '2029-02-28');
  assert.equal(dateKey(addInterval(d('2026-07-04'), 'YEARLY')), '2027-07-04');
});

test('catchUp: nothing due when the schedule starts in the future', () => {
  const res = catchUp({nextDueDate: d('2026-12-01'), interval: 'MONTHLY'}, d('2026-10-03'));
  assert.deepEqual(res.due, []);
  assert.equal(dateKey(res.nextDue!), '2026-12-01');
});

test('catchUp: posts every missed occurrence up to today, then the next future one', () => {
  const res = catchUp({nextDueDate: d('2026-08-01'), interval: 'MONTHLY'}, d('2026-10-03'));
  assert.deepEqual(res.due.map(dateKey), ['2026-08-01', '2026-09-01', '2026-10-01']);
  assert.equal(dateKey(res.nextDue!), '2026-11-01');
});

test('catchUp: today counts as due', () => {
  const res = catchUp({nextDueDate: d('2026-10-03'), interval: 'WEEKLY'}, d('2026-10-03'));
  assert.deepEqual(res.due.map(dateKey), ['2026-10-03']);
  assert.equal(dateKey(res.nextDue!), '2026-10-10');
});

test('catchUp: stops at the end date', () => {
  const res = catchUp(
    {nextDueDate: d('2026-09-01'), interval: 'MONTHLY', endDate: d('2026-10-15')},
    d('2026-12-01'),
  );
  assert.deepEqual(res.due.map(dateKey), ['2026-09-01', '2026-10-01']);
  assert.equal(res.nextDue, null);
});

test('catchUp: iteration cap prevents runaway schedules', () => {
  const res = catchUp({nextDueDate: d('2020-01-01'), interval: 'WEEKLY'}, d('2026-10-03'), 10);
  assert.equal(res.due.length, 10);
  assert.ok(res.nextDue);
});

test('toRecurringDto exposes countdown and status fields', () => {
  const now = d('2026-10-03');
  const dto = toRecurringDto(
    {
      id: 'r1',
      description: 'Netflix',
      amount: 649,
      type: 'WANT',
      categoryId: 'c1',
      paymentMethod: 'CREDIT_CARD',
      creditCardId: 'cc1',
      interval: 'MONTHLY',
      startDate: d('2026-08-02'),
      nextDueDate: d('2026-10-02'),
      endDate: null,
      autoPost: true,
      paused: false,
      notes: null,
      category: {name: 'Subscriptions'},
      creditCard: {cardName: 'HDFC Regalia'},
    },
    now,
  );
  assert.equal(dto.amount, 649);
  assert.equal(dto.nextDueDate, '2026-10-02');
  assert.equal(dto.overdue, true);
  assert.equal(dto.daysToDue, -1);
  assert.equal(dto.categoryName, 'Subscriptions');
  assert.equal(dto.cardName, 'HDFC Regalia');
  assert.equal(formatInterval(dto.interval), 'monthly');
});

test('todayKey returns a local calendar date', () => {
  const now = new Date(2026, 9, 3, 23, 30);
  assert.equal(todayKey(now), '2026-10-03');
});
