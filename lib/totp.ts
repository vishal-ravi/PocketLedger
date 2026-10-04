import {createHash, createHmac, randomBytes, timingSafeEqual} from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = B32.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpAt(secret: string, timeSeconds: number, digits = 6, step = 30): string {
  const counter = Math.floor(timeSeconds / step);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function totpCode(secret: string, now = Date.now()): string {
  return totpAt(secret, Math.floor(now / 1000));
}

export function verifyTotp(secret: string, code: string, now = Date.now(), window = 1): boolean {
  const clean = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  const seconds = Math.floor(now / 1000);
  const actual = Buffer.from(clean, 'utf8');
  for (let offset = -window; offset <= window; offset++) {
    const expected = Buffer.from(totpAt(secret, seconds + offset * 30), 'utf8');
    if (actual.length === expected.length && timingSafeEqual(actual, expected)) return true;
  }
  return false;
}

export function otpauthUri(email: string, secret: string, issuer = 'PocketLedger'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`;
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

export function normalizeBackupCode(code: string): string {
  return code.replace(/[^0-9a-z]/gi, '').toUpperCase();
}

export function generateBackupCodes(count = 8): string[] {
  const codes: string[] = [];
  while (codes.length < count) {
    const raw = base32Encode(randomBytes(5)).slice(0, 8);
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return codes;
}

export function hashBackupCode(code: string): string {
  return createHash('sha256').update(normalizeBackupCode(code)).digest('hex');
}

export function hashBackupCodes(codes: string[]): string[] {
  return codes.map(hashBackupCode);
}

export function verifyBackupCode(hashed: string[], code: string): boolean {
  const candidate = hashBackupCode(code);
  return hashed.some((entry) => entry.length === candidate.length && timingSafeEqual(Buffer.from(entry), Buffer.from(candidate)));
}
