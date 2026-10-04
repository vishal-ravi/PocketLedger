import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectGoal, toDto} from '../lib/goals';

const today = new Date(2026, 9, 3); // 3 Oct 2026 (local)

test('projectGoal estimates months and finish date', () => {
  const result = projectGoal({targetAmount: 120000, savedAmount: 60000, contribution: 10000, today});
  assert.equal(result.monthsNeeded, 6);
  assert.equal(result.reachDate, '2027-04-03');
  assert.equal(result.shortfall, 0);
});

test('projectGoal marks a goal on track when the pace beats the deadline', () => {
  const result = projectGoal({
    targetAmount: 100000,
    savedAmount: 20000,
    contribution: 40000,
    targetDate: '2026-12-31',
    today,
  });
  assert.equal(result.monthsNeeded, 2);
  assert.equal(result.reachDate, '2026-12-03');
  assert.equal(result.onTrack, true);
  assert.equal(result.shortfall, 0);
});

test('projectGoal reports the shortfall when the pace misses the deadline', () => {
  const result = projectGoal({
    targetAmount: 100000,
    savedAmount: 0,
    contribution: 5000,
    targetDate: '2027-03-31',
    today,
  });
  assert.equal(result.monthsNeeded, 20);
  assert.equal(result.onTrack, false);
  assert.ok(result.shortfall > 0);
});

test('projectGoal clamps month-end finish dates', () => {
  const result = projectGoal({
    targetAmount: 30000,
    savedAmount: 0,
    contribution: 10000,
    today: new Date(2026, 10, 30), // 30 Nov 2026
  });
  assert.equal(result.monthsNeeded, 3);
  assert.equal(result.reachDate, '2027-02-28'); // Feb has no 30th
});

test('projectGoal treats a finished goal as complete', () => {
  const result = projectGoal({targetAmount: 50000, savedAmount: 50000, contribution: 0, today});
  assert.equal(result.monthsNeeded, 0);
  assert.equal(result.onTrack, true);
  assert.equal(result.shortfall, 0);
});

test('projectGoal with zero contribution never reaches the target', () => {
  const result = projectGoal({targetAmount: 50000, savedAmount: 10000, contribution: 0, targetDate: '2027-01-01', today});
  assert.equal(result.reachDate, null);
  assert.equal(result.onTrack, false);
  assert.equal(result.shortfall, 40000);
});

test('toDto exposes progress, pacing and deadline math', () => {
  const dto = toDto({
    id: 'g1',
    name: 'Emergency fund',
    targetAmount: '300000',
    savedAmount: '75000',
    targetDate: new Date(2027, 0, 1),
    colorCode: '#10b981',
  });
  assert.equal(dto.progress, 25);
  assert.equal(dto.remaining, 225000);
  assert.ok(dto.daysLeft !== null && dto.daysLeft > 0);
  assert.ok(dto.perMonth > 0);
});
