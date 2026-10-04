import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword, verifyPassword} from '../lib/password';

test('hashPassword → verifyPassword round-trip', async () => {
  const hash = await hashPassword('correct horse battery');
  assert.ok(hash.startsWith('scrypt$'));
  assert.equal(await verifyPassword('correct horse battery', hash), true);
  assert.equal(await verifyPassword('wrong password', hash), false);
  assert.equal(await verifyPassword('', hash), false);
});

test('same password hashes differently each time (random salt)', async () => {
  const a = await hashPassword('same-password');
  const b = await hashPassword('same-password');
  assert.notEqual(a, b);
  assert.equal(await verifyPassword('same-password', a), true);
  assert.equal(await verifyPassword('same-password', b), true);
});

test('verifyPassword rejects malformed or missing hashes', async () => {
  assert.equal(await verifyPassword('x', null), false);
  assert.equal(await verifyPassword('x', ''), false);
  assert.equal(await verifyPassword('x', 'not-a-hash'), false);
  assert.equal(await verifyPassword('x', 'scrypt$abc'), false);
});
