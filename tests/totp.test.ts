import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  base32Decode,
  base32Encode,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  normalizeBackupCode,
  otpauthUri,
  totpAt,
  verifyBackupCode,
  verifyTotp,
} from '../lib/totp';

// RFC 6238 appendix B: SHA-1, secret "12345678901234567890" (base32 below).
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('base32 round-trips arbitrary bytes', () => {
  for (const input of ['', 'a', 'hello world', 'PocketLedger 2FA', '\xff\x00\x01']) {
    const buf = Buffer.from(input, 'utf8');
    assert.deepEqual(base32Decode(base32Encode(buf)), buf);
  }
  assert.equal(base32Decode('MZXW6===').toString('utf8'), 'foo');
});

test('totp matches the RFC 6238 SHA-1 test vectors', () => {
  const vectors: [number, string][] = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];
  for (const [time, expected] of vectors) {
    assert.equal(totpAt(RFC_SECRET, time, 8), expected, `t=${time}`);
  }
});

test('totpCode is stable inside a step and changes after it', () => {
  const secret = generateTotpSecret();
  // steps align to absolute 30s boundaries: 999990 … 1000019 is one step
  const first = totpAt(secret, 1_000_000);
  assert.equal(totpAt(secret, 999_991), first);
  assert.equal(totpAt(secret, 1_000_019), first);
  assert.notEqual(totpAt(secret, 1_000_020), first);
  assert.notEqual(totpAt(secret, 999_989), first);
});

test('verifyTotp accepts the current step and its neighbours only', () => {
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000;
  const seconds = Math.floor(now / 1000);
  assert.equal(verifyTotp(secret, totpAt(secret, seconds), now), true);
  assert.equal(verifyTotp(secret, totpAt(secret, seconds - 30), now), true);
  assert.equal(verifyTotp(secret, totpAt(secret, seconds + 30), now), true);
  assert.equal(verifyTotp(secret, totpAt(secret, seconds - 90), now), false);
  assert.equal(verifyTotp(secret, '123456', now), false);
  assert.equal(verifyTotp(secret, 'abcdef', now), false);
});

test('otpauth uri carries issuer, account and parameters', () => {
  const secret = generateTotpSecret();
  const uri = otpauthUri('demo@example.com', secret);
  assert.match(uri, /^otpauth:\/\/totp\/PocketLedger:demo%40example\.com\?/);
  assert.match(uri, new RegExp(`secret=${secret}`));
  assert.match(uri, /issuer=PocketLedger/);
  assert.match(uri, /digits=6/);
});

test('backup codes generate, normalise and verify', () => {
  const codes = generateBackupCodes(8);
  assert.equal(codes.length, 8);
  assert.equal(new Set(codes).size, 8);
  assert.ok(codes.every((code) => /^[A-Z2-7]{4}-[A-Z2-7]{4}$/.test(code)));

  const hashed = codes.map(hashBackupCode);
  const lower = codes[0].toLowerCase().replace('-', ' ');
  assert.equal(normalizeBackupCode(lower).length, 8);
  assert.equal(verifyBackupCode(hashed, lower), true);
  assert.equal(verifyBackupCode(hashed, 'AAAA-BBBB'), false);
});
