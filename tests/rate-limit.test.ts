import {test, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {clientIp, failHit, hit, isLocked, reset, _resetAll} from '../lib/rate-limit';

beforeEach(() => _resetAll());

test('hit allows up to the limit then rejects with retry-after', () => {
  assert.equal(hit('k', 3, 1000).ok, true);
  assert.equal(hit('k', 3, 1000).ok, true);
  const third = hit('k', 3, 1000);
  assert.equal(third.ok, true);
  const fourth = hit('k', 3, 1000);
  assert.equal(fourth.ok, false);
  assert.ok(fourth.retryAfter >= 1);
  assert.equal(fourth.remaining, 0);
});

test('hit windows slide (old attempts expire)', async () => {
  assert.equal(hit('k2', 1, 50).ok, true);
  assert.equal(hit('k2', 1, 50).ok, false);
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(hit('k2', 1, 50).ok, true);
});

test('failHit locks after max failures and reset clears it', () => {
  for (let i = 0; i < 4; i++) {
    assert.equal(failHit('email:a', 5, 60_000, 60_000).locked, false);
  }
  const fifth = failHit('email:a', 5, 60_000, 60_000);
  assert.equal(fifth.locked, true);
  assert.equal(isLocked('email:a', 5, 60_000, 60_000), true);

  reset('email:a');
  assert.equal(isLocked('email:a', 5, 60_000, 60_000), false);
});

test('isLocked does not record failures by itself', () => {
  assert.equal(isLocked('email:b', 5, 60_000, 60_000), false);
  assert.equal(isLocked('email:b', 5, 60_000, 60_000), false);
});

test('clientIp prefers x-forwarded-for', () => {
  const h = new Headers({'x-forwarded-for': '203.0.113.9, 10.0.0.1'});
  assert.equal(clientIp(h), '203.0.113.9');
  assert.equal(clientIp(new Headers()), 'local');
});
