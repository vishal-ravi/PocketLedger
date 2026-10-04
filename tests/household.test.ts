import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateInviteCode, householdNameFor, normalizeInviteCode, pickNewOwner} from '../lib/household';

test('invite codes are eight unambiguous characters', () => {
  const codes = new Set<string>();
  for (let i = 0; i < 60; i++) {
    const code = generateInviteCode();
    assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    assert.doesNotMatch(code, /[01OIL]/);
    codes.add(code);
  }
  assert.equal(codes.size, 60, 'codes should not collide across 60 draws');
  assert.match(generateInviteCode(6), /^[A-Z2-9]{6}$/);
});

test('invite codes normalise the way people type them', () => {
  assert.equal(normalizeInviteCode('ab12-cd34'), 'AB12CD34');
  assert.equal(normalizeInviteCode('  kmnp 2345 '), 'KMNP2345');
  assert.equal(normalizeInviteCode(''), '');
  assert.equal(normalizeInviteCode(null), '');
  assert.equal(normalizeInviteCode(undefined), '');
});

test('ownership passes to the longest-standing member', () => {
  const now = Date.now();
  const members = [
    {userId: 'owner', role: 'OWNER', joinedAt: new Date(now)},
    {userId: 'newcomer', role: 'MEMBER', joinedAt: new Date(now + 5000)},
    {userId: 'veteran', role: 'MEMBER', joinedAt: new Date(now - 5000)},
  ];
  assert.deepEqual(pickNewOwner(members), {userId: 'veteran'});
  assert.deepEqual(pickNewOwner(members.slice(0, 2)), {userId: 'newcomer'});
  assert.equal(pickNewOwner([{userId: 'owner', role: 'OWNER', joinedAt: new Date()}]), null);
  assert.equal(pickNewOwner([]), null);
});

test('default household names use the first name', () => {
  assert.equal(householdNameFor('Ada Lovelace'), "Ada's household");
  assert.equal(householdNameFor('  Grace  Hopper  '), "Grace's household");
  assert.equal(householdNameFor('Cher'), "Cher's household");
  assert.equal(householdNameFor(''), 'Our household');
  assert.equal(householdNameFor(null), 'Our household');
  assert.equal(householdNameFor(undefined), 'Our household');
});
