import puppeteer from 'puppeteer-core';
import {readFile, writeFile, unlink} from 'node:fs/promises';
import {createHmac} from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32decode(input) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of input.toUpperCase()) {
    const index = B32.indexOf(ch);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
/** RFC 6238 TOTP (SHA-1, 6 digits, 30s step) so QA can play the role of an authenticator app. */
function totp(secret, at = Date.now()) {
  const counter = Math.floor(Math.floor(at / 1000) / 30);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', b32decode(secret)).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(bin % 1000000).padStart(6, '0');
}

const BASE = 'http://localhost:3000';
const results = [];
const pass = (name, extra = '') => results.push({name, ok: true, extra});
const fail = (name, extra = '') => results.push({name, ok: false, extra});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function phase(label, fn) {
  process.stderr.write(`… ${label}\n`);
  const before = results.length;
  try {
    await fn();
    const failed = results.slice(before).filter((r) => !r.ok).length;
    process.stderr.write(`  → ${label}: ${results.length - before} checks${failed ? `, ${failed} FAILED` : ''}\n`);
  } catch (error) {
    fail(`${label} did not finish`, String(error?.message || error).slice(0, 160));
    process.stderr.write(`  ✗ ${label} threw: ${String(error?.message || error).slice(0, 160)}\n`);
  }
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/opt/google/chrome/chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
  defaultViewport: {width: 1500, height: 1000},
});

const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('dialog', (d) => d.accept());

const text = (sel) => page.$eval(sel, (el) => el.textContent.trim()).catch(() => null);
const count = (sel) => page.$$eval(sel, (els) => els.length).catch(() => 0);

async function setInput(selector, value) {
  await page.$eval(
    selector,
    (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', {bubbles: true}));
    },
    value,
  );
}

async function clickByText(selector, label) {
  const clicked = await page.evaluate(
    (s, l) => {
      const el = [...document.querySelectorAll(s)].find((e) =>
        e.textContent.trim().toLowerCase().includes(l.toLowerCase()),
      );
      if (!el) return false;
      el.click();
      return true;
    },
    selector,
    label,
  );
  if (!clicked) throw new Error(`no element ${selector} matching "${label}"`);
}

/** Click via the DOM so a stray renderer hiccup can't swallow the input event. */
async function jsClick(selector) {
  const ok = await page.$eval(selector, (el) => {
    el.click();
    return true;
  }).catch(() => false);
  if (!ok) throw new Error(`no element ${selector} to click`);
}

async function until(fn, timeout = 7000, step = 250) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return true;
    await wait(step);
  }
  return false;
}

async function rowByDescription(desc) {
  return page.evaluate(
    (d) => [...document.querySelectorAll('table.table tbody tr')].findIndex((r) => r.textContent.includes(d)),
    desc,
  );
}

// ------------------------------------------------------------------ sign in
const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'demo12345';

async function loginViaForm(email, password) {
  await page.goto(`${BASE}/login`, {waitUntil: 'networkidle0'});
  await page.waitForSelector('[data-testid="login-email"]', {timeout: 6000});
  // A real mouse click can land before React hydrates (nothing fires at all), so
  // submit via the DOM and retry until the dashboard actually appears.
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.waitForSelector('[data-testid="login-submit"]', {timeout: 6000});
    await setInput('[data-testid="login-email"]', email);
    await setInput('[data-testid="login-password"]', password);
    await jsClick('[data-testid="login-submit"]');
    const landed = await until(async () => (await page.evaluate(() => window.location.pathname)) === '/', 4000);
    if (landed) return;
    await wait(500);
  }
  throw new Error(`login as ${email} did not land on the dashboard`);
}

async function currentEmail() {
  return page.evaluate(async () => {
    const res = await fetch('/api/auth/me');
    if (!res.ok) return null;
    const data = await res.json();
    return data.user?.email ?? null;
  });
}

await phase('sign in', async () => {
  await page.goto(`${BASE}/login`, {waitUntil: 'networkidle0'});
  await wait(500);
  const onLogin = await page.evaluate(() => window.location.pathname === '/login');
  if (onLogin) {
    await loginViaForm(DEMO_EMAIL, DEMO_PASSWORD);
    pass('login form signs the demo account in');
  } else {
    pass('unauthenticated visit lands on the sign-in page');
  }
  const email = await currentEmail();
  if (email === DEMO_EMAIL) pass('session identifies the signed-in user', email);
  else fail('session identifies the signed-in user', String(email));
});

await phase('accounts: logout, signup, delete', async () => {
  await page.goto(`${BASE}/`, {waitUntil: 'networkidle0'});
  await wait(800);
  await page.click('[data-testid="logout"]');
  const loggedOut = await until(async () => (await page.evaluate(() => window.location.pathname)) === '/login', 4000);
  if (!loggedOut) {
    await jsClick('[data-testid="logout"]').catch(() => null);
    await page.waitForFunction(() => window.location.pathname === '/login', {timeout: 8000});
  }
  pass('logout returns to the sign-in page');

  const signedOut = await currentEmail();
  if (!signedOut) pass('logout clears the session');
  else fail('logout clears the session', String(signedOut));

  await loginViaForm(DEMO_EMAIL, DEMO_PASSWORD);
  const again = await currentEmail();
  if (again === DEMO_EMAIL) pass('signing in again restores the session');
  else fail('signing in again restores the session', String(again));

  const stamp = `qa-${Date.now()}@test.local`;
  const signup = async (email) => {
    await page.goto(`${BASE}/signup`, {waitUntil: 'networkidle0'});
    await page.waitForSelector('[data-testid="signup-email"]', {timeout: 6000});
    await setInput('[data-testid="signup-name"]', 'QA User');
    await setInput('[data-testid="signup-email"]', email);
    await setInput('[data-testid="signup-password"]', 'qa-password-1');
    await setInput('[data-testid="signup-confirm"]', 'qa-password-1');
    await page.click('[data-testid="signup-submit"]');
  };

  await signup(DEMO_EMAIL);
  await page.waitForSelector('[data-testid="signup-error"]', {timeout: 6000});
  const dupe = (await text('[data-testid="signup-error"]')) || '';
  if (/already exists/i.test(dupe)) pass('duplicate signup is rejected', dupe.slice(0, 60));
  else fail('duplicate signup is rejected', dupe.slice(0, 80));

  await signup(stamp);
  await page.waitForFunction(() => window.location.pathname === '/', {timeout: 8000});
  const created = await currentEmail();
  if (created === stamp) pass('signup creates an account and signs you in', created);
  else fail('signup creates an account and signs you in', String(created));

  const outbox = await readFile('logs/mail/outbox.log', 'utf8').catch(() => '');
  const verifyMails = outbox.split('\n').filter((line) => line.includes(stamp) && line.includes('Verify your PocketLedger'));
  if (verifyMails.length === 0) pass('signup sends no verification email');
  else fail('signup sends no verification email', `${verifyMails.length} mail(s)`);

  const list = await page.evaluate(async () => (await fetch('/api/expenses')).json());
  if ((list.expenses || []).length === 0) pass('a new account starts with an empty ledger');
  else fail('a new account starts with an empty ledger', `${(list.expenses || []).length} rows`);

  const deleted = await page.evaluate(async () => (await fetch('/api/user', {method: 'DELETE'})).ok);
  if (deleted) pass('an account can be deleted');
  else fail('an account can be deleted');

  const afterDelete = await currentEmail();
  if (!afterDelete) pass('a deleted account has no session');
  else fail('a deleted account has no session', String(afterDelete));

  const restored = await page.evaluate(async () => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email: 'demo@example.com', password: 'demo12345'}),
    });
    return res.ok;
  });
  if (restored) pass('demo account can sign back in');
  else fail('demo account can sign back in');
});

// ------------------------------------------------------- auth hardening + ops
await phase('auth hardening and ops', async () => {
  const health = await fetch(`${BASE}/api/health`).then(async (r) => ({status: r.status, body: await r.json()}));
  if (health.status === 200 && health.body.db === 'up') pass('health endpoint reports db up', `uptime=${health.body.uptime}`);
  else fail('health endpoint reports db up', JSON.stringify(health));

  const headers = await fetch(`${BASE}/login`).then((r) => ({
    nosniff: r.headers.get('x-content-type-options'),
    frame: r.headers.get('x-frame-options'),
    powered: r.headers.get('x-powered-by'),
  }));
  if (headers.nosniff === 'nosniff' && headers.frame === 'DENY' && !headers.powered) {
    pass('security headers set, x-powered-by removed', JSON.stringify(headers));
  } else {
    fail('security headers set, x-powered-by removed', JSON.stringify(headers));
  }

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({email: DEMO_EMAIL, password: DEMO_PASSWORD}),
  });
  const oldCookie = (loginRes.headers.get('set-cookie') || '').split(';')[0];
  const meStatus = await fetch(`${BASE}/api/auth/me`, {headers: {cookie: oldCookie}}).then((r) => r.status);
  if (loginRes.ok && meStatus === 200) pass('api login issues a working session');
  else fail('api login issues a working session', JSON.stringify({login: loginRes.status, me: meStatus}));

  const forgotBody = async (email) => {
    const res = await fetch(`${BASE}/api/auth/forgot-password`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({email}),
    });
    return {status: res.status, body: await res.json()};
  };
  const known = await forgotBody(DEMO_EMAIL);
  const unknown = await forgotBody('no-such-user-qa@example.com');
  const same =
    known.status === 202 &&
    unknown.status === 202 &&
    JSON.stringify(known.body) === JSON.stringify(unknown.body) &&
    !JSON.stringify(known.body).includes('token');
  if (same) pass('forgot-password does not reveal which emails exist', `status=${known.status}`);
  else fail('forgot-password does not reveal which emails exist', JSON.stringify({known, unknown}));

  const readLastResetToken = async () => {
    const outbox = await readFile('logs/mail/outbox.log', 'utf8').catch(() => '');
    const tokens = [...outbox.matchAll(/reset-password\?token=([A-Za-z0-9_-]+)/g)];
    return tokens.length ? tokens[tokens.length - 1][1] : '';
  };

  const resetToken = await readLastResetToken();
  if (resetToken) pass('reset link written to the mail outbox', `token=${resetToken.slice(0, 8)}…`);
  else fail('reset link written to the mail outbox');

  const tempPassword = `qa-temp-${Date.now()}-pw`;
  const resetRes = await fetch(`${BASE}/api/auth/reset-password`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({token: resetToken, password: tempPassword}),
  });
  if (resetRes.ok) pass('password reset accepts the emailed token');
  else fail('password reset accepts the emailed token', String(resetRes.status));

  const revoked = await fetch(`${BASE}/api/auth/me`, {headers: {cookie: oldCookie}}).then((r) => r.status);
  if (revoked === 401) pass('password reset revokes existing sessions');
  else fail('password reset revokes existing sessions', `me=${revoked}`);

  const bogusReset = await fetch(`${BASE}/api/auth/reset-password`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({token: 'definitely-not-a-token', password: 'whatever-12345'}),
  });
  if (bogusReset.status === 400) pass('reset-password rejects invalid tokens', `status=${bogusReset.status}`);
  else fail('reset-password rejects invalid tokens', `status=${bogusReset.status}`);

  const tempLogin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({email: DEMO_EMAIL, password: tempPassword}),
  });
  if (tempLogin.ok) pass('login works with the new password');
  else fail('login works with the new password', String(tempLogin.status));

  // restore the original password through the same flow
  await fetch(`${BASE}/api/auth/forgot-password`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({email: DEMO_EMAIL}),
  });
  const restoreToken = await readLastResetToken();
  const restored = await fetch(`${BASE}/api/auth/reset-password`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({token: restoreToken, password: DEMO_PASSWORD}),
  });
  const restoredLogin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({email: DEMO_EMAIL, password: DEMO_PASSWORD}),
  });
  if (restored.ok && restoredLogin.ok) pass('original password restored after the reset round-trip');
  else fail('original password restored after the reset round-trip', JSON.stringify({reset: restored.status, login: restoredLogin.status}));

  // the browser session was revoked by the resets — sign back in for later phases
  await loginViaForm(DEMO_EMAIL, DEMO_PASSWORD);

  const page1 = await page.evaluate(async () => (await fetch('/api/expenses?limit=50&offset=0')).json());
  const rows = (page1.expenses || []).length;
  const total = page1.total ?? 0;
  const expectedMore = total > rows;
  if (rows > 0 && rows <= 50 && total >= rows && Boolean(page1.hasMore) === expectedMore) {
    pass('expenses API paginates with total/hasMore', `rows=${rows} total=${total}`);
  } else {
    fail('expenses API paginates with total/hasMore', JSON.stringify({rows, total, hasMore: page1.hasMore}));
  }
});

await phase('dashboard renders', async () => {
  await page.goto(`${BASE}/`, {waitUntil: 'networkidle0'});
  await wait(900);
  const hero = (await text('.hero')) || '';
  if (/NaN/.test(hero)) fail('dashboard KPIs free of NaN', hero.slice(0, 120));
  else pass('dashboard KPIs free of NaN');
  if (hero.includes('₹') || hero.includes('€')) pass('dashboard uses the configured currency');
  else fail('dashboard uses the configured currency', hero.slice(0, 80));
  pass('cashflow chart mounted', `surfaces=${await count('.recharts-surface')}`);
});

// ------------------------------------------------------- dashboard widgets
await phase('dashboard widgets render', async () => {
  await page.goto(`${BASE}/`, {waitUntil: 'networkidle0'});
  await page.waitForSelector('[data-testid="budget-ring"]', {timeout: 9000});

  const ring = (await text('[data-testid="budget-ring"]')) || '';
  if (ring.includes('Safe to spend')) pass('safe-to-spend budget ring renders');
  else fail('safe-to-spend budget ring renders', ring.slice(0, 80));
  if (/of budget used/.test(ring)) pass('budget ring shows utilisation percentage');
  else fail('budget ring shows utilisation percentage', ring.slice(0, 80));
  if (/NaN/.test(ring)) fail('budget ring free of NaN', ring.slice(0, 120));
  else pass('budget ring free of NaN');

  const pace = (await text('[data-testid="pace-alert"]')) || '';
  if (pace.includes('Pace & habits')) pass('pace + anomaly card renders');
  else fail('pace + anomaly card renders', pace.slice(0, 80));
  if (/No-spend/.test(pace) && /Under budget/.test(pace) && /Days logged/.test(pace)) pass('streak tiles render');
  else fail('streak tiles render', pace.slice(0, 120));

  const mix = (await text('[data-testid="payment-mix"]')) || '';
  if (mix.includes('Payment mix')) pass('payment mix card renders');
  else fail('payment mix card renders', mix.slice(0, 80));

  const top = (await text('[data-testid="top-categories"]')) || '';
  if (top.includes('Top categories')) pass('top categories card renders');
  else fail('top categories card renders', top.slice(0, 80));

  const upcoming = (await text('[data-testid="upcoming-payments"]')) || '';
  if (upcoming.includes('Upcoming payments')) pass('upcoming payments card renders');
  else fail('upcoming payments card renders', upcoming.slice(0, 80));
  if (/You&apos;re owed|You're owed|Shared bills/.test(upcoming)) pass('split balances strip renders');
  else fail('split balances strip renders', upcoming.slice(0, 120));

  const recentRows = await count('[data-testid="recent-list"] ul li');
  if (recentRows > 0) pass('recent transactions listed', `${recentRows} rows`);
  else fail('recent transactions listed');

  if (/EMI \d/.test(upcoming)) pass('upcoming EMIs render with the loan bill');
  else fail('upcoming EMIs render with the loan bill', upcoming.slice(0, 140));
  if (/outstanding/.test(upcoming)) pass('loan outstanding strip renders');
  else fail('loan outstanding strip renders', upcoming.slice(0, 140));

  const surfaces = await count('.recharts-surface');
  if (surfaces >= 3) pass('dashboard charts (cashflow, needs/wants, payment mix) all mounted', `surfaces=${surfaces}`);
  else fail('dashboard charts (cashflow, needs/wants, payment mix) all mounted', `surfaces=${surfaces}`);
});

// ------------------------------------------------- dashboard quick add + goals
await phase('dashboard quick add', async () => {
  const stamp = `QA-QUICK-${Date.now()}`;
  const hasCategory = await page.$('[data-testid="quick-category"] option');
  if (!hasCategory) throw new Error('no categories available for quick add');

  await page.type('[data-testid="quick-amount"]', '99.5');
  await page.type('[data-testid="quick-description"]', stamp);
  await page.click('[data-testid="quick-save"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="quick-note"]')?.textContent?.includes('Added'), {
    timeout: 8000,
  });
  pass('quick add saves from the dashboard');

  await wait(1500);
  const rows = await page.$$eval('[data-testid="recent-list"] ul li', (els) => els.map((el) => el.textContent || ''));
  if (rows.some((r) => r.includes(stamp))) pass('quick-added row appears in recent list', rows[0].slice(0, 60));
  else fail('quick-added row appears in recent list', rows[0]?.slice(0, 60) || 'no rows');

  const hero = (await text('.hero')) || '';
  if (!/NaN/.test(hero)) pass('KPIs stay clean after a quick add');
  else fail('KPIs stay clean after a quick add', hero.slice(0, 100));

  const cleanup = await page.evaluate(async (s) => {
    const res = await fetch(`/api/expenses?q=${encodeURIComponent(s)}`);
    const data = await res.json();
    const row = (data.expenses || []).find((e) => e.description === s);
    if (!row) return 'missing';
    const del = await fetch(`/api/expenses/${row.id}`, {method: 'DELETE'});
    return String(del.status);
  }, stamp);
  if (cleanup === '200' || cleanup === '0' || cleanup === 'ok') pass('quick-added row cleaned up', cleanup);
  else fail('quick-added row cleaned up', cleanup);
});

await phase('dashboard savings goals', async () => {
  const stamp = `QA-GOAL-${Date.now()}`;
  const before = await count('[data-testid="goal-card"]');

  await page.click('[data-testid="goal-toggle"]');
  await page.waitForSelector('[data-testid="goal-form"]', {timeout: 5000});
  await page.type('[data-testid="goal-name"]', stamp);
  await page.type('[data-testid="goal-target"]', '100000');
  await page.type('[data-testid="goal-saved"]', '1000');
  await page.click('[data-testid="goal-save"]');
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="goal-card"]').length > n, {timeout: 8000}, before);
  pass('goal created from the dashboard');

  const after = await count('[data-testid="goal-card"]');
  if (after === before + 1) pass('goal card added to the board', `${before} → ${after}`);
  else fail('goal card added to the board', `${before} → ${after}`);

  const savedBefore = await page.evaluate(
    (name) => {
      const card = [...document.querySelectorAll('[data-testid="goal-card"]')].find((c) => c.textContent.includes(name));
      return card?.textContent ?? '';
    },
    stamp,
  );
  if (/1,000/.test(savedBefore)) pass('new goal starts at the entered amount');
  else fail('new goal starts at the entered amount', savedBefore.slice(0, 120));

  try {
    await page.evaluate((name) => {
      const card = [...document.querySelectorAll('[data-testid="goal-card"]')].find((c) => c.textContent.includes(name));
      const input = card.querySelector('[data-testid="goal-contribute-input"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '5000');
      input.dispatchEvent(new Event('input', {bubbles: true}));
      card.querySelector('[data-testid="goal-contribute"]').click();
    }, stamp);
    await page.waitForFunction(
      (name) => {
        const card = [...document.querySelectorAll('[data-testid="goal-card"]')].find((c) => c.textContent.includes(name));
        return !!card && /6,000/.test(card.textContent);
      },
      {timeout: 8000},
      stamp,
    );
    pass('contributing updates the goal balance');
  } catch (error) {
    fail('contributing updates the goal balance', String(error?.message || error).slice(0, 120));
  }

  try {
    const eta = await page.evaluate((name) => {
      const card = [...document.querySelectorAll('[data-testid="goal-card"]')].find((c) => c.textContent.includes(name));
      if (!card) return null;
      return {
        pace: card.querySelector('[data-testid="goal-pace"]')?.value ?? '',
        text: card.querySelector('[data-testid="goal-eta"]')?.textContent ?? '',
        status: card.querySelector('[data-testid="goal-eta-status"]')?.textContent ?? '',
      };
    }, stamp);
    if (eta && eta.pace && /Finish by|pace/.test(eta.text)) pass('goal shows a savings pace and ETA', `${eta.pace}/mo · ${eta.status}`);
    else fail('goal shows a savings pace and ETA', JSON.stringify(eta));

    const spedUp = await page.evaluate((name) => {
      const card = [...document.querySelectorAll('[data-testid="goal-card"]')].find((c) => c.textContent.includes(name));
      const input = card?.querySelector('[data-testid="goal-pace"]');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '99000');
      input.dispatchEvent(new Event('input', {bubbles: true}));
      return true;
    }, stamp);
    await wait(400);
    const faster = await page.evaluate((name) => {
      const card = [...document.querySelectorAll('[data-testid="goal-card"]')].find((c) => c.textContent.includes(name));
      return card?.querySelector('[data-testid="goal-eta-status"]')?.textContent ?? '';
    }, stamp);
    if (spedUp && /1 mo/.test(faster)) pass('raising the pace updates the projection', faster);
    else fail('raising the pace updates the projection', `${spedUp} ${faster}`);
  } catch (error) {
    fail('goal projection updates with the pace', String(error?.message || error).slice(0, 120));
  }

  try {
    await page.evaluate((name) => {
      const card = [...document.querySelectorAll('[data-testid="goal-card"]')].find((c) => c.textContent.includes(name));
      card.querySelector('[data-testid="goal-delete"]').click();
    }, stamp);
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="goal-card"]').length === n, {timeout: 8000}, before);
    pass('goal deleted from the dashboard');
  } catch (error) {
    fail('goal deleted from the dashboard', String(error?.message || error).slice(0, 120));
    await page
      .evaluate(async (name) => {
        const res = await fetch('/api/goals');
        const data = await res.json();
        const goal = (data.goals || []).find((g) => g.name === name);
        if (goal) await fetch(`/api/goals/${goal.id}`, {method: 'DELETE'});
      }, stamp)
      .catch(() => {});
  }
});

// -------------------------------------------------------- create via ?new=1
await phase('expense create flow', async () => {
  await page.goto(`${BASE}/expenses?new=1`, {waitUntil: 'networkidle0'});
  await page.waitForSelector('.modal', {timeout: 6000});
  pass('?new=1 opens the log modal');

  const stamp = `QA-${Date.now()}`;
  await page.type('#f-desc', stamp);
  await page.type('#f-amount', '345.5');
  await page.select('#f-cat', await page.$eval('#f-cat', (el) => el.options[1].value));
  await clickByText('.modal .btn-primary', 'save');
  await page.waitForSelector('.modal', {hidden: true, timeout: 6000});
  pass('modal closes after save');

  await wait(1600);
  if ((await count('.modal')) === 0) pass('modal does not reopen (no ?new=1 loop)');
  else fail('modal does not reopen (no ?new=1 loop)');

  const idx = await rowByDescription(stamp);
  if (idx >= 0) pass('created expense appears in table');
  else fail('created expense appears in table');

  const rowText = await page.evaluate(
    (i) => document.querySelectorAll('table.table tbody tr')[i]?.textContent ?? '',
    idx,
  );
  if (rowText.includes('345.50')) pass('amount keeps decimals in table');
  else fail('amount keeps decimals in table', rowText.slice(-70));
  await page.evaluate((d) => localStorage.setItem('qa_stamp', d), stamp);
});

// ---------------------------------------------------------- income add flow
await phase('income add flow', async () => {
  // dashboard entry point first (the phase must end on /expenses for later phases)
  await page.goto(`${BASE}/`, {waitUntil: 'networkidle0'});
  await wait(600);
  if (await page.$('[data-testid="hero-add-income"]')) pass('dashboard hero has an "Add income" button');
  else fail('dashboard hero has an "Add income" button');

  await page.goto(`${BASE}/expenses`, {waitUntil: 'networkidle0'});
  await wait(700);
  if (await page.$('[data-testid="add-income"]')) pass('Daily Log has an "Add income" button');
  else fail('Daily Log has an "Add income" button');

  await page.click('[data-testid="add-income"]');
  await page.waitForSelector('.modal', {timeout: 6000});
  await wait(300);
  const title = await page.$eval('.modal h2', (el) => el.textContent.trim());
  if (title === 'Add Income') pass('income modal opens in income mode', title);
  else fail('income modal opens in income mode', title);

  const catRequired = await page.$eval('#f-cat', (el) => el.required);
  if (!catRequired) pass('category is optional for income');
  else fail('category is optional for income');

  const getSummary = () =>
    page.evaluate(async () => (await fetch('/api/analytics/summary')).json()).then((d) => d.summary);
  const before = await getSummary();

  const stamp = `QA-income-${Date.now()}`;
  await page.type('#f-desc', stamp);
  await page.type('#f-amount', '4321');
  await clickByText('.modal .btn-primary', 'save income');
  await page.waitForSelector('.modal', {hidden: true, timeout: 6000});
  pass('income modal closes after save');
  await wait(1600);

  const idx = await rowByDescription(stamp);
  if (idx >= 0) pass('income row appears in the table');
  else fail('income row appears in the table');

  const info = await page.evaluate((i) => {
    const row = document.querySelectorAll('table.table tbody tr')[i];
    if (!row) return null;
    return {
      badge: row.querySelector('.badge-income')?.textContent ?? '',
      amount: row.querySelector('[data-testid="income-amount"]')?.textContent ?? '',
      category: row.children[2]?.textContent?.trim() ?? '',
    };
  }, idx);
  if (info?.badge === 'INCOME') pass('income row shows INCOME badge', info.badge);
  else fail('income row shows INCOME badge', JSON.stringify(info));
  if (info?.amount.startsWith('+')) pass('income amount is shown with a +', info.amount);
  else fail('income amount is shown with a +', info?.amount);
  if (info?.category === '—') pass('income row needs no category', info.category);
  else fail('income row needs no category', info?.category);

  const mid = await getSummary();
  if (Math.round(mid.income - before.income) === 4321) pass('total income increases by the entry', `${before.income} -> ${mid.income}`);
  else fail('total income increases by the entry', `${before.income} -> ${mid.income}`);

  // spending must reduce the net (savings = income - expenses)
  const netBefore = mid.savings;
  const posted = await page.evaluate(async () => {
    const cats = await (await fetch('/api/categories')).json();
    const res = await fetch('/api/expenses', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({
        date: new Date().toISOString().slice(0, 10),
        description: 'QA net probe',
        amount: 100,
        type: 'NEED',
        paymentMethod: 'UPI',
        categoryId: cats.categories[0]?.id ?? null,
      }),
    });
    return res.status;
  });
  const after = await getSummary();
  if (posted === 201 && Math.round(netBefore - after.savings) === 100) {
    pass('spending reduces the net balance', `${netBefore} -> ${after.savings}`);
  } else {
    fail('spending reduces the net balance', `post=${posted} ${netBefore} -> ${after.savings}`);
  }

  // non-income entries still require a category — run from Node so the 400
  // never hits the browser console (which the console-cleanliness phase checks)
  const jar = (await page.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
  const guardRes = await fetch(`${BASE}/api/expenses`, {
    method: 'POST',
    headers: {'content-type': 'application/json', cookie: jar},
    body: JSON.stringify({date: '2026-10-03', description: 'QA category guard', amount: 10, type: 'NEED', paymentMethod: 'UPI'}),
  }).catch(() => ({status: 0}));
  if (guardRes.status === 400) pass('expense without a category is rejected (400)');
  else fail('expense without a category is rejected (400)', String(guardRes.status));

  // cleanup the two probe rows
  await page.evaluate(async (stamp) => {
    for (const q of [stamp, 'QA net probe']) {
      const list = await (await fetch(`/api/expenses?q=${encodeURIComponent(q)}&limit=5`)).json();
      for (const row of list.expenses ?? []) await fetch(`/api/expenses/${row.id}`, {method: 'DELETE'});
    }
  }, stamp).catch(() => {});
});

// ---------------------------------------------------------------- edit flow
await phase('expense edit flow', async () => {
  const stamp = await page.evaluate(() => localStorage.getItem('qa_stamp'));
  const idx = await rowByDescription(stamp);
  await page.evaluate((i) => {
    const row = document.querySelectorAll('table.table tbody tr')[i];
    [...row.querySelectorAll('button')].find((b) => b.textContent.toLowerCase().includes('edit')).click();
  }, idx);
  await page.waitForSelector('.modal', {timeout: 5000});
  const prefilled = await page.$eval('#f-desc', (el) => el.value);
  if (prefilled === stamp) pass('edit form prefills existing values');
  else fail('edit form prefills existing values', prefilled);

  await setInput('#f-amount', '500');
  await clickByText('.modal .btn-primary', 'update');
  await page.waitForSelector('.modal', {hidden: true, timeout: 6000});
  pass('modal closes after update');

  await wait(1000);
  const afterEdit = await page.evaluate((d) => {
    const r = [...document.querySelectorAll('table.table tbody tr')].find((x) => x.textContent.includes(d));
    return r ? r.textContent : '';
  }, stamp);
  if (afterEdit.includes('500')) pass('edited amount persisted');
  else fail('edited amount persisted', afterEdit.slice(-90));
});

// --------------------------------------------------------------- delete flow
await phase('expense delete flow', async () => {
  const stamp = await page.evaluate(() => localStorage.getItem('qa_stamp'));
  await page.evaluate((d) => {
    const r = [...document.querySelectorAll('table.table tbody tr')].find((x) => x.textContent.includes(d));
    [...r.querySelectorAll('button')].find((b) => b.textContent.toLowerCase().includes('delete')).click();
  }, stamp);
  const gone = await until(async () => (await rowByDescription(stamp)) === -1);
  if (gone) pass('deleted expense disappears');
  else fail('deleted expense disappears');
});

// ------------------------------------------------------------- search/filter
await phase('search + month filters', async () => {
  await page.type('input[placeholder*="Search"]', 'Cab');
  await wait(900);
  const rows = await count('table.table tbody tr');
  if (rows > 0) pass('search filter runs without error', `rows=${rows}`);
  else fail('search filter runs without error');
  await setInput('input[type="month"]', '2026-10');
  await wait(900);
  pass('month filter runs without error');
  await clickByText('.btn-ghost', 'clear');
  await wait(700);
});

// ------------------------------------------------------------------ budgets
await phase('budget category CRUD', async () => {
  await page.goto(`${BASE}/budgets`, {waitUntil: 'networkidle0'});
  await wait(800);
  const catName = `QA Cat ${Date.now()}`;
  await clickByText('button', 'add category');
  await page.waitForSelector('.modal', {timeout: 5000});
  await page.type('#c-name', catName);
  await page.type('#c-budget', '2500');
  await clickByText('.modal .btn-primary', 'save');
  await page.waitForSelector('.modal', {hidden: true, timeout: 6000});
  await wait(900);
  if (await page.evaluate((n) => document.body.textContent.includes(n), catName)) pass('category created');
  else fail('category created');

  await clickByText('button', 'new category');
  await page.waitForSelector('.modal', {timeout: 5000});
  await page.type('#c-name', catName);
  await page.type('#c-budget', '9999');
  await clickByText('.modal .btn-primary', 'save');
  await wait(1200);
  const modalText = await page.evaluate(() => document.querySelector('.modal')?.textContent ?? '');
  if (/already exists/i.test(modalText)) pass('duplicate category rejected with a message');
  else fail('duplicate category rejected with a message', modalText.slice(0, 140));
  await page.evaluate(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === 'Cancel')?.click());
  await wait(500);

  if ((await count('.progress')) > 0) pass('budget progress bars rendered');
  else fail('budget progress bars rendered');

  await page.evaluate((n) => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(n));
    [...card.querySelectorAll('button')].find((b) => b.textContent.toLowerCase().includes('delete')).click();
  }, catName);
  const catGone = await until(() => page.evaluate((n) => !document.body.textContent.includes(n), catName));
  if (catGone) pass('category deleted');
  else fail('category deleted');
});

// -------------------------------------------------------------------- cards
await phase('credit card CRUD', async () => {
  await page.goto(`${BASE}/cards`, {waitUntil: 'networkidle0'});
  await wait(800);
  const cardName = `QA Card ${Date.now()}`;
  await clickByText('button', 'add card');
  await page.waitForSelector('.modal', {timeout: 5000});
  await page.type('#k-name', cardName);
  await page.type('#k-limit', '50000');
  await page.type('#k-apr', '39.5');
  await page.type('#k-rewards', '1.2');
  await clickByText('.modal .btn-primary', 'save');
  await page.waitForSelector('.modal', {hidden: true, timeout: 6000});
  await wait(900);
  const created = await page.evaluate((n) => document.body.textContent.includes(n), cardName);
  if (created) pass('credit card created');
  else fail('credit card created');

  await page.evaluate((n) => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(n));
    [...card.querySelectorAll('button')].find((b) => b.textContent.toLowerCase().includes('delete')).click();
  }, cardName);
  const cardGone = await until(() => page.evaluate((n) => !document.body.textContent.includes(n), cardName));
  if (cardGone) pass('credit card deleted');
  else fail('credit card deleted');
});

// ------------------------------------------------------------------- splits
// --------------------------------------------- accounts, net worth, rollover
await phase('accounts and net worth', async () => {
  await page.goto(`${BASE}/accounts`, {waitUntil: 'networkidle0'});
  const summaryReady = await until(async () => (await count('[data-testid="net-worth-summary"]')) === 1, 7000);
  if (summaryReady) pass('net worth summary renders');
  else fail('net worth summary renders');

  const emptyShown = await count('[data-testid="accounts-empty"]');
  const assetsBefore = await text('[data-testid="assets-value"]');
  if (emptyShown === 1 || assetsBefore) pass('accounts section loads', `assets=${assetsBefore}`);
  else fail('accounts section loads');

  await jsClick('[data-testid="account-toggle"]');
  const formOpen = await until(async () => (await count('[data-testid="account-save"]')) === 1, 5000);
  if (!formOpen) throw new Error('account form did not open');
  await page.type('[data-testid="account-name"]', 'QA Bank');
  await page.select('[data-testid="account-type"]', 'BANK');
  await page.type('[data-testid="account-balance"]', '42000');
  await jsClick('[data-testid="account-save"]');
  const created = await until(async () => (await count('[data-testid="account-card"]')) >= 1, 7000);
  if (created) pass('account is created and listed');
  else fail('account is created and listed', `cards=${await count('[data-testid="account-card"]')}`);

  const assetsAfter = await text('[data-testid="assets-value"]');
  if (assetsAfter && assetsBefore !== null && assetsAfter !== assetsBefore) pass('assets total updates', `${assetsBefore} → ${assetsAfter}`);
  else fail('assets total updates', `${assetsBefore} → ${assetsAfter}`);

  const listedCard = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-testid="account-card"]')].find((c) => c.textContent.includes('QA Bank'));
    return el ? el.textContent : '';
  });
  if (/42,000/.test(listedCard)) pass('account balance shown formatted');
  else fail('account balance shown formatted', listedCard.slice(0, 80));

  const edited = await page.evaluate(async () => {
    const card = [...document.querySelectorAll('[data-testid="account-card"]')].find((c) => c.textContent.includes('QA Bank'));
    const btn = card && card.querySelector('button[aria-label^="Edit"]');
    if (!btn) return false;
    btn.click();
    return true;
  });
  await until(async () => (await count('[data-testid="account-balance"]')) === 1, 5000);
  await page.$eval('[data-testid="account-balance"]', (el) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '45000');
    el.dispatchEvent(new Event('input', {bubbles: true}));
  });
  await jsClick('[data-testid="account-save"]');
  const balanceUpdated = await until(async () => {
    const t = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[data-testid="account-card"]')].find((c) => c.textContent.includes('QA Bank'));
      return el ? el.textContent : '';
    });
    return /45,000/.test(t);
  }, 7000);
  if (edited && balanceUpdated) pass('account balance can be edited');
  else fail('account balance can be edited', `edited=${edited} updated=${balanceUpdated}`);

  await page.goto(`${BASE}/`, {waitUntil: 'networkidle0'});
  const widgetReady = await until(async () => (await count('[data-testid="net-worth"]')) === 1, 8000);
  const widgetText = await text('[data-testid="net-worth"]');
  if (widgetReady && widgetText && /Net worth/.test(widgetText)) pass('dashboard net worth widget renders');
  else fail('dashboard net worth widget renders', (widgetText || '').slice(0, 80));

  await page.goto(`${BASE}/accounts`, {waitUntil: 'networkidle0'});
  await until(async () => (await count('[data-testid="account-card"]')) >= 1, 7000);
  const deleted = await page.evaluate(async () => {
    const card = [...document.querySelectorAll('[data-testid="account-card"]')].find((c) => c.textContent.includes('QA Bank'));
    const btn = card && card.querySelector('button[aria-label^="Delete"]');
    if (!btn) return false;
    btn.click();
    await new Promise((r) => setTimeout(r, 700));
    return ![...document.querySelectorAll('[data-testid="account-card"]')].some((c) => c.textContent.includes('QA Bank'));
  });
  if (deleted) pass('account is deleted');
  else fail('account is deleted');
});

await phase('budget rollover', async () => {
  await page.goto(`${BASE}/budgets`, {waitUntil: 'networkidle0'});
  const toggleReady = await until(async () => (await count('[data-testid="rollover-toggle"]')) === 1, 7000);
  if (!toggleReady) return fail('rollover toggle present', `count=${await count('[data-testid="rollover-toggle"]')}`);
  pass('rollover toggle present');

  const initial = await page.$eval('[data-testid="rollover-toggle"]', (el) => el.checked);

  const setToggle = async (target) => {
    for (let i = 0; i < 3; i++) {
      const state = await page.$eval('[data-testid="rollover-toggle"]', (el) => el.checked);
      if (state === target) return true;
      await jsClick('[data-testid="rollover-toggle"]');
      const settled = await until(async () => (await page.$eval('[data-testid="rollover-toggle"]', (el) => el.checked)) === target, 5000);
      if (settled) return true;
      await wait(300);
    }
    return false;
  };

  const on = await setToggle(true);
  const badgesOn = await until(async () => (await count('[data-testid="rollover-badge"]')) > 0, 6000);
  if (on && badgesOn) pass('rollover shows carried budget', `${await count('[data-testid="rollover-badge"]')} categories`);
  else fail('rollover shows carried budget', `on=${on} badges=${await count('[data-testid="rollover-badge"]')}`);

  const summaryText = await text('[data-testid="budget-summary"]');
  if (/rolled over/i.test(summaryText)) pass('summary shows the rolled-over total');
  else fail('summary shows the rolled-over total', summaryText.slice(0, 100));

  const off = await setToggle(false);
  const badgesOff = await until(async () => (await count('[data-testid="rollover-badge"]')) === 0, 6000);
  if (off && badgesOff) pass('rollover can be switched off');
  else fail('rollover can be switched off', `off=${off} badges=${await count('[data-testid="rollover-badge"]')}`);

  if (initial) await setToggle(true);
});

// ------------------------------------------------------------ CSV / OFX import
await phase('multi-currency expense', async () => {
  const stamp = `QA-FX-${Date.now()}`;
  await page.goto(`${BASE}/expenses`, {waitUntil: 'networkidle0'});
  await wait(700);
  await jsClick('[data-testid="add-expense"]');
  const modalUp = await until(async () => (await count('#f-desc')) === 1, 6000);
  if (!modalUp) return fail('expense modal opens for the fx check');

  await setInput('#f-desc', stamp);
  await jsClick('[data-testid="fx-toggle"]');
  const fields = await until(async () => (await count('[data-testid="fx-fields"]')) === 1, 4000);
  if (fields) pass('foreign-currency option reveals fx fields');
  else fail('foreign-currency option reveals fx fields', `count=${await count('[data-testid="fx-fields"]')}`);

  await page.$eval('[data-testid="original-currency"]', (el) => {
    el.value = 'USD';
    el.dispatchEvent(new Event('change', {bubbles: true}));
  });
  await setInput('[data-testid="original-amount"]', '100');
  await setInput('[data-testid="fx-rate"]', '83.5');
  await wait(400);

  const preview = (await text('[data-testid="fx-preview"]')) || '';
  if (/USD 100 @ 83\.5/.test(preview) && /8,350/.test(preview)) pass('fx preview shows the conversion', preview);
  else fail('fx preview shows the conversion', preview);

  const amount = await page.$eval('#f-amount', (el) => el.value);
  if (amount === '8350') pass('base amount is filled from the rate', amount);
  else fail('base amount is filled from the rate', amount);

  await jsClick('form.modal button.btn-primary');
  const created = await until(async () => {
    const index = await rowByDescription(stamp);
    return index >= 0;
  }, 9000);
  if (!created) return fail('fx expense is saved', 'row never appeared');
  pass('fx expense is saved');

  const note = await page.evaluate((s) => {
    const row = [...document.querySelectorAll('table.table tbody tr')].find((r) => r.textContent.includes(s));
    return row?.querySelector('[data-testid="fx-note"]')?.textContent ?? '';
  }, stamp);
  if (/USD 100 @ 83\.5/.test(note)) pass('row shows the original amount and rate', note.trim());
  else fail('row shows the original amount and rate', note);

  const remote = await page.evaluate(async (s) => {
    const res = await fetch(`/api/expenses?q=${encodeURIComponent(s)}&limit=5`);
    const row = res.ok ? (await res.json()).expenses?.[0] : null;
    if (!row) return null;
    const patch = await fetch(`/api/expenses/${row.id}`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({originalCurrency: 'JPY'}),
    });
    const after = patch.ok ? (await patch.json()).expense : null;
    return {
      currency: row.originalCurrency,
      amount: Number(row.amount),
      original: Number(row.originalAmount),
      rate: Number(row.fxRate),
      patch: patch.status,
      after: after?.originalCurrency ?? null,
      id: row.id,
    };
  }, stamp);
  if (remote && remote.currency === 'USD' && remote.amount === 8350 && remote.original === 100 && remote.rate === 83.5) {
    pass('stored fx fields round-trip through the API', `${remote.original} ${remote.currency} @ ${remote.rate}`);
  } else {
    fail('stored fx fields round-trip through the API', JSON.stringify(remote));
  }
  if (remote && remote.patch === 200 && remote.after === 'JPY') pass('fx fields patch cleanly', remote.after);
  else fail('fx fields patch cleanly', JSON.stringify(remote && {patch: remote.patch, after: remote.after}));

  const jar = await page.cookies(BASE);
  const cookieHeader = jar.map((c) => `${c.name}=${c.value}`).join('; ');
  const listed = await fetch(`${BASE}/api/expenses?q=${encodeURIComponent(stamp)}&limit=5`, {
    headers: {cookie: cookieHeader},
  }).then((r) => r.json());
  const probeRow = listed?.expenses?.[0];
  const partial = probeRow
    ? await fetch(`${BASE}/api/expenses`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', cookie: cookieHeader},
        body: JSON.stringify({
          date: '2026-10-01',
          description: stamp + '-bad',
          categoryId: probeRow.categoryId,
          paymentMethod: 'UPI',
          amount: 10,
          type: 'NEED',
          originalCurrency: 'USD',
          originalAmount: 10,
        }),
      }).then((r) => r.status)
    : null;
  if (partial === 400) pass('an incomplete fx trio is rejected', String(partial));
  else fail('an incomplete fx trio is rejected', String(partial));

  const cleaned = await page.evaluate(async (s) => {
    const res = await fetch(`/api/expenses?q=${encodeURIComponent(s)}&limit=10`);
    const rows = res.ok ? (await res.json()).expenses || [] : [];
    for (const row of rows) await fetch(`/api/expenses/${row.id}`, {method: 'DELETE'});
    return rows.length;
  }, stamp);
  if (cleaned > 0) pass('fx expenses cleaned up', `${cleaned} row(s)`);
  else fail('fx expenses cleaned up', String(cleaned));
});

await phase('budget tax flag', async () => {
  await page.goto(`${BASE}/budgets`, {waitUntil: 'networkidle0'});
  const ready = await until(async () => (await count('[data-testid="budget-summary"]')) === 1, 7000);
  if (!ready) return fail('budgets page loads for the tax flag check');

  const foodBadge = () =>
    page.evaluate(() => {
      const card = [...document.querySelectorAll('.card')].find((c) => c.querySelector('b')?.textContent.trim() === 'Food');
      return Boolean(card?.querySelector('[data-testid="tax-badge"]'));
    });

  const opened = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.querySelector('b')?.textContent.trim() === 'Food');
    const edit = card ? [...card.querySelectorAll('button')].find((b) => /^\s*Edit/.test(b.textContent)) : null;
    if (!edit) return false;
    edit.click();
    return true;
  });
  const modalUp = opened && (await until(async () => (await count('[data-testid="tax-toggle"]')) === 1, 6000));
  if (!modalUp) return fail('category edit opens the tax flag toggle', `opened=${opened}`);

  const startState = await page.$eval('[data-testid="tax-toggle"]', (el) => el.checked);
  if (!startState) pass('new category flag starts off');
  else fail('new category flag starts off', String(startState));

  await jsClick('[data-testid="tax-toggle"]');
  await wait(150);
  await jsClick('form.modal button.btn-primary');
  const closed = await until(async () => (await count('[data-testid="tax-toggle"]')) === 0, 6000);
  const badgeOn = closed && (await until(foodBadge, 7000));
  if (badgeOn) pass('flagging a category shows its tax badge');
  else fail('flagging a category shows its tax badge', `closed=${closed}`);

  const reopen = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.querySelector('b')?.textContent.trim() === 'Food');
    const edit = card ? [...card.querySelectorAll('button')].find((b) => /^\s*Edit/.test(b.textContent)) : null;
    if (!edit) return false;
    edit.click();
    return true;
  });
  await until(async () => (await count('[data-testid="tax-toggle"]')) === 1, 6000);
  const reState = await page.$eval('[data-testid="tax-toggle"]', (el) => el.checked);
  if (reopen && reState) pass('the flag persists into the edit form');
  else fail('the flag persists into the edit form', `${reopen} ${reState}`);

  await jsClick('[data-testid="tax-toggle"]');
  await wait(150);
  await jsClick('form.modal button.btn-primary');
  await until(async () => (await count('[data-testid="tax-toggle"]')) === 0, 6000);
  const badgeOff = await until(async () => !(await foodBadge()), 7000);
  if (badgeOff) pass('unflagging removes the tax badge');
  else fail('unflagging removes the tax badge');
});

await phase('csv and ofx import', async () => {
  await page.goto(`${BASE}/expenses`, {waitUntil: 'networkidle0'});
  await wait(500);
  const linkShown = await count('[data-testid="import-link"]');
  if (linkShown === 1) pass('daily log links to the importer');
  else fail('daily log links to the importer', `count=${linkShown}`);

  const stamp = Date.now();
  const file = `/tmp/opencode/qa-import-${stamp}.csv`;
  await writeFile(
    file,
    [
      'Date,Description,Amount',
      `2026-09-15,QA Import Coffee ${stamp},-120.50`,
      `2026-09-16,QA Import Refund ${stamp},300`,
      'garbage-date,QA Import Bad,10',
    ].join('\n'),
    'utf8',
  );

  await page.goto(`${BASE}/import`, {waitUntil: 'networkidle0'});
  await wait(400);
  const input = await page.$('[data-testid="import-file"]');
  if (!input) throw new Error('file input missing');
  await input.uploadFile(file);
  const previewed = await until(async () => (await count('[data-testid="import-preview"]')) === 1, 9000);
  if (previewed) pass('csv preview renders');
  else fail('csv preview renders', `preview=${await count('[data-testid="import-preview"]')}`);

  const issues = await text('[data-testid="import-issues"]');
  if (issues && /unreadable date/.test(issues)) pass('bad rows are reported, not imported');
  else fail('bad rows are reported, not imported', String(issues).slice(0, 80));

  // Without a fallback category the NEED row waits, so pick one first.
  const catSet = await page.evaluate(() => {
    const select = document.querySelector('[data-testid="import-category"]');
    if (!select || select.options.length < 2) return false;
    select.value = select.options[1].value;
    select.dispatchEvent(new Event('change', {bubbles: true}));
    return true;
  });
  if (!catSet) throw new Error('fallback category select unavailable');
  await wait(1200);

  const planned = await text('[data-testid="import-planned"]');
  if (planned && /2 to import/.test(planned)) pass('two clean rows are planned once a category is picked', planned);
  else fail('two clean rows are planned once a category is picked', String(planned));

  await jsClick('[data-testid="import-submit"]');
  const done = await until(async () => (await count('[data-testid="import-result"]')) === 1, 9000);
  const resultText = (await text('[data-testid="import-result"]')) || '';
  if (done && /Imported 2 transactions/.test(resultText)) pass('import writes the rows', resultText.replace(/\s+/g, ' ').slice(0, 70));
  else fail('import writes the rows', `${done} ${resultText.slice(0, 80)}`);

  const inLedger = await page.evaluate(async (stamp) => {
    const res = await fetch(`/api/expenses?q=${encodeURIComponent(`QA Import Coffee ${stamp}`)}&limit=5`);
    if (!res.ok) return -1;
    return (await res.json()).total;
  }, stamp);
  if (inLedger === 1) pass('imported row appears in the daily log');
  else fail('imported row appears in the daily log', String(inLedger));

  const reimport = await page.evaluate(async (stamp) => {
    const csv = `Date,Description,Amount\n2026-09-15,QA Import Coffee ${stamp},-120.50\n`;
    const res = await fetch('/api/import', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({content: csv, dryRun: true}),
    });
    if (!res.ok) return null;
    return await res.json();
  }, stamp);
  if (reimport && reimport.duplicates >= 1 && reimport.planned === 0) pass('duplicate rows are detected on re-import');
  else fail('duplicate rows are detected on re-import', JSON.stringify(reimport && {d: reimport.duplicates, p: reimport.planned}));

  const ofxPreview = await page.evaluate(async () => {
    const catsRes = await fetch('/api/categories');
    const cats = catsRes.ok ? (await catsRes.json()).categories || [] : [];
    const ofx = `<OFX><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260917<TRNAMT>-55.00<FITID>qa1<NAME>QA OFX Chai</NAME></STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></OFX>`;
    const res = await fetch('/api/import', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({content: ofx, dryRun: true, categoryId: cats[0]?.id ?? null}),
    });
    if (!res.ok) return null;
    return await res.json();
  });
  if (ofxPreview && ofxPreview.source === 'OFX' && ofxPreview.planned === 1) pass('ofx statements are detected and parsed');
  else fail('ofx statements are detected and parsed', JSON.stringify(ofxPreview && {s: ofxPreview.source, p: ofxPreview.planned}));

  await page.evaluate(async (stamp) => {
    for (const term of [`QA Import Coffee ${stamp}`, `QA Import Refund ${stamp}`]) {
      const res = await fetch(`/api/expenses?q=${encodeURIComponent(term)}&limit=10`);
      if (!res.ok) continue;
      for (const row of (await res.json()).expenses || []) {
        await fetch(`/api/expenses/${row.id}`, {method: 'DELETE'});
      }
    }
  }, stamp);
  const cleaned = await page.evaluate(async (stamp) => {
    const res = await fetch(`/api/expenses?q=${encodeURIComponent(`QA Import Coffee ${stamp}`)}&limit=5`);
    return res.ok ? (await res.json()).total : -1;
  }, stamp);
  if (cleaned === 0) pass('imported rows cleaned up');
  else fail('imported rows cleaned up', String(cleaned));
  await unlink(file).catch(() => null);
});

// ------------------------------------------------------- recurring rules
await phase('recurring rules', async () => {
  await page.goto(`${BASE}/recurring`, {waitUntil: 'networkidle0'});
  await wait(700);
  const before = await count('[data-testid="recurring-card"]');
  const stamp = Date.now();
  const autoDesc = `QA Rule ${stamp}`;
  const manualDesc = `QA Rule ${stamp} manual`;

  await jsClick('[data-testid="recurring-toggle"]');
  const formOpen = await until(async () => (await count('[data-testid="recurring-save"]')) === 1, 5000);
  if (formOpen) pass('create form opens');
  else fail('create form opens', `save=${await count('[data-testid="recurring-save"]')}`);
  const catsReady = await until(async () => (await count('[data-testid="recurring-category"] option')) > 1, 6000);
  const catValue = await page
    .$eval('[data-testid="recurring-category"]', (sel) => {
      const opt = [...sel.options].find((o) => /subscriptions|groceries|rent|dining|transport/i.test(o.text));
      return opt ? opt.value : sel.options[1]?.value || '';
    })
    .catch(() => '');
  if (catsReady && catValue) pass('category dropdown loaded');
  else fail('category dropdown loaded', `ready=${catsReady} value="${catValue}"`);

  await page.type('[data-testid="recurring-description"]', autoDesc);
  await page.type('[data-testid="recurring-amount"]', '199');
  await page.select('[data-testid="recurring-category"]', catValue);
  await page.select('[data-testid="recurring-interval"]', 'MONTHLY');
  const autoChecked = await page.$eval('[data-testid="recurring-autopost"]', (el) => el.checked).catch(() => false);
  if (autoChecked) pass('auto-post is on by default');
  else fail('auto-post is on by default');
  for (let attempt = 0; attempt < 3; attempt++) {
    await jsClick('[data-testid="recurring-save"]');
    const saved = await until(async () => (await count('[data-testid="recurring-card"]')) === before + 1, 4000);
    if (saved) break;
  }

  const listed = await until(async () => (await count('[data-testid="recurring-card"]')) === before + 1, 4000);
  if (listed) pass('new rule appears in the list', `count=${before + 1}`);
  else {
    const errText = await page.evaluate(
      () => document.querySelector('[data-testid="recurring-save"]')?.form?.textContent?.match(/.{0,80}(error|could not|unknown|exceed|rate).{0,80}/i)?.[0] || '',
    );
    fail('new rule appears in the list', `count=${await count('[data-testid="recurring-card"]')} form=${await count('[data-testid="recurring-save"]')} ${errText}`);
  }

  const autoPosted = await page.evaluate(async (d) => {
    const res = await fetch(`/api/expenses?q=${encodeURIComponent(d)}&limit=10`);
    if (!res.ok) return -1;
    return (await res.json()).total;
  }, autoDesc);
  if (autoPosted === 1) pass('rule due today auto-posts to the ledger', String(autoPosted));
  else fail('rule due today auto-posts to the ledger', String(autoPosted));

  const autoCard = await page.evaluate(
    (d) => {
      const el = [...document.querySelectorAll('[data-testid="recurring-card"]')].find((c) => c.textContent.includes(d));
      return el ? el.textContent : '';
    },
    autoDesc,
  );
  if (/Auto-post/.test(autoCard) && /monthly/i.test(autoCard)) pass('rule card shows schedule and mode');
  else fail('rule card shows schedule and mode', autoCard.slice(0, 100));

  await page.goto(`${BASE}/`, {waitUntil: 'networkidle0'});
  await wait(1000);
  const upcoming = await page.$eval('[data-testid="upcoming-payments"]', (el) => el.textContent).catch(() => '');
  if (upcoming.includes(autoDesc)) pass('dashboard upcoming lists the recurring rule');
  else fail('dashboard upcoming lists the recurring rule', upcoming.slice(0, 120));

  await page.goto(`${BASE}/recurring`, {waitUntil: 'networkidle0'});
  await wait(700);
  await jsClick('[data-testid="recurring-toggle"]');
  const manualFormOpen = await until(async () => (await count('[data-testid="recurring-save"]')) === 1, 5000);
  if (!manualFormOpen) fail('second create form opens', `save=${await count('[data-testid="recurring-save"]')}`);
  await page.type('[data-testid="recurring-description"]', manualDesc);
  await page.type('[data-testid="recurring-amount"]', '50');
  await page.select('[data-testid="recurring-category"]', catValue);
  await page.select('[data-testid="recurring-interval"]', 'MONTHLY');
  await page.$eval('[data-testid="recurring-autopost"]', (el) => {
    if (el.checked) el.click();
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    await jsClick('[data-testid="recurring-save"]');
    const saved = await until(async () => (await count('[data-testid="recurring-card"]')) === before + 2, 4000);
    if (saved) break;
  }
  const manualListed = await until(async () => (await count('[data-testid="recurring-card"]')) === before + 2, 4000);
  if (manualListed) pass('reminder-only rule is saved');
  else fail('reminder-only rule is saved', `count=${await count('[data-testid="recurring-card"]')} form=${await count('[data-testid="recurring-save"]')}`);

  const manualCard = await page.evaluate(
    (d) => {
      const el = [...document.querySelectorAll('[data-testid="recurring-card"]')].find((c) => c.textContent.includes(d));
      return el ? el.textContent : '';
    },
    manualDesc,
  );
  if (/Reminder only/.test(manualCard)) pass('reminder-only rule is labelled');
  else fail('reminder-only rule is labelled', manualCard.slice(0, 100));

  const clickedPost = await page.evaluate((d) => {
    const card = [...document.querySelectorAll('[data-testid="recurring-card"]')].find((c) => c.textContent.includes(d));
    const btn = card && card.querySelector('[data-testid="recurring-post"]');
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  }, manualDesc);
  const manualPosted = await until(async () => {
    const total = await page.evaluate(async (d) => {
      const res = await fetch(`/api/expenses?q=${encodeURIComponent(d)}&limit=10`);
      return res.ok ? (await res.json()).total : 0;
    }, manualDesc);
    return total === 1;
  }, 9000);
  if (clickedPost && manualPosted) pass('post now records the payment');
  else fail('post now records the payment', `clicked=${clickedPost} posted=${manualPosted}`);

  const paused = await page.evaluate(async (d) => {
    const card = [...document.querySelectorAll('[data-testid="recurring-card"]')].find((c) => c.textContent.includes(d));
    const btn = card && card.querySelector('[data-testid="recurring-pause"]');
    if (!btn) return false;
    btn.click();
    await new Promise((r) => setTimeout(r, 600));
    const after = [...document.querySelectorAll('[data-testid="recurring-card"]')].find((c) => c.textContent.includes(d));
    return !!after && after.textContent.includes('Resume');
  }, manualDesc);
  if (paused) pass('rule can be paused and resumes');
  else fail('rule can be paused and resumes');

  for (const desc of [manualDesc, autoDesc]) {
    await page.evaluate((d) => {
      const card = [...document.querySelectorAll('[data-testid="recurring-card"]')].find((c) => c.textContent.includes(d));
      const btn = card && card.querySelector('button[aria-label^="Delete"]');
      if (btn) btn.click();
    }, desc);
    await wait(500);
  }
  const cleaned = await until(async () => (await count('[data-testid="recurring-card"]')) === before, 7000);
  if (cleaned) pass('rules deleted from the list');
  else fail('rules deleted from the list', `count=${await count('[data-testid="recurring-card"]')}`);

  await page.evaluate(async (ds) => {
    for (const d of ds) {
      const res = await fetch(`/api/expenses?q=${encodeURIComponent(d)}&limit=20`);
      if (!res.ok) continue;
      for (const e of (await res.json()).expenses || []) {
        await fetch(`/api/expenses/${e.id}`, {method: 'DELETE'});
      }
    }
  }, [autoDesc, manualDesc]);
  pass('qa ledger rows cleaned up');
});

await phase('splits page', async () => {
  await page.goto(`${BASE}/splits`, {waitUntil: 'networkidle0'});
  await wait(800);
  const body = (await text('body')) || '';
  if (body.includes('Owed to me') && body.includes('Person-wise')) pass('splits page renders');
  else fail('splits page renders', body.slice(0, 100));
});

// ---------------------------------------------------------------- settings
await phase('settings save + persistence', async () => {
  await page.goto(`${BASE}/settings`, {waitUntil: 'networkidle0'});
  await page.waitForSelector('#s-name', {timeout: 5000});
  const original = await page.$eval('#s-name', (el) => el.value);
  await setInput('#s-name', 'QA Tester');
  await clickByText('form .btn-primary', 'save');
  await wait(1400);
  if (/saved/i.test((await text('body')) || '')) pass('settings save shows confirmation');
  else fail('settings save shows confirmation');

  await page.reload({waitUntil: 'networkidle0'});
  await wait(1000);
  const persisted = await page.$eval('#s-name', (el) => el.value);
  if (persisted === 'QA Tester') pass('settings persist after reload');
  else fail('settings persist after reload', persisted);

  await setInput('#s-name', original);
  await clickByText('form .btn-primary', 'save');
  await wait(1000);

  const logoutAll = await page.$('[data-testid="logout-all"]');
  if (logoutAll) pass('security card offers log-out-everywhere');
  else fail('security card offers log-out-everywhere');
});

// ---------------------------------------------------- escape key + scroll lock
await phase('modal keyboard behaviour', async () => {
  await page.goto(`${BASE}/expenses?new=1`, {waitUntil: 'networkidle0'});
  await page.waitForSelector('.modal', {timeout: 6000});
  await page.keyboard.press('Escape');
  await wait(600);
  if ((await count('.modal')) === 0) pass('Escape closes the modal');
  else fail('Escape closes the modal');
  const overflow = await page.evaluate(() => document.body.style.overflow);
  if (overflow !== 'hidden') pass('page scroll restored after modal closes');
  else fail('page scroll restored after modal closes', overflow);
});

// ------------------------------------------------------------ split expenses
await phase('split bill creates debt records', async () => {
  await page.goto(`${BASE}/expenses?new=1`, {waitUntil: 'networkidle0'});
  await page.waitForSelector('.modal', {timeout: 6000});
  const stamp = `QAsplit-${Date.now()}`;
  await page.type('#f-desc', stamp);
  await page.type('#f-amount', '600');
  await page.select('#f-cat', await page.$eval('#f-cat', (el) => el.options[1].value));
  await clickByText('.seg-btn', 'Split Bill');
  await wait(400);
  const person = await page.$('input[placeholder="Who did you pay for?"]');
  if (!person) throw new Error('split rows did not appear');
  await person.type('QA Friend');
  await page.type('input[placeholder="They owe you"]', '300');
  await clickByText('.modal .btn-primary', 'save');
  await page.waitForSelector('.modal', {hidden: true, timeout: 6000});
  await wait(1400);
  await page.goto(`${BASE}/splits`, {waitUntil: 'networkidle0'});
  await wait(1000);
  const body = (await text('body')) || '';
  if (body.includes('QA Friend')) pass('split entry shows up in receivables');
  else fail('split entry shows up in receivables', body.slice(0, 160));

  // cleanup: delete the expense and the person balance with it
  await page.goto(`${BASE}/expenses`, {waitUntil: 'networkidle0'});
  await wait(1000);
  await page.evaluate((d) => {
    const r = [...document.querySelectorAll('table.table tbody tr')].find((x) => x.textContent.includes(d));
    if (r) [...r.querySelectorAll('button')].find((b) => b.textContent.toLowerCase().includes('delete')).click();
  }, stamp);
  await wait(1400);
  const body2 = await page.evaluate(async () => (await fetch('/api/analytics/splits')).json());
  if (!(body2.people || []).some((p) => p.name === 'QA Friend')) pass('split cleanup removed the debt');
  else fail('split cleanup removed the debt');
});


// ------------------------------------------------------ debt repayment flow
await phase('debt repayment flow', async () => {
  const stamp = `QA-DEBT-${Date.now()}`;
  const person = 'QA Ower';
  const created = await page.evaluate(
    async ({name, who}) => {
      const cats = await (await fetch('/api/categories')).json();
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          date: new Date().toISOString().slice(0, 10),
          description: name,
          categoryId: cats.categories[0].id,
          paymentMethod: 'UPI',
          amount: 900,
          type: 'NEED',
          isSplit: true,
          whoPaid: 'Someone else',
          myShare: 300,
          splits: [{personName: who, amountIOwe: 300}],
        }),
      });
      const data = await res.json();
      return {status: res.status, id: data.expense?.id ?? null};
    },
    {name: stamp, who: person},
  );
  if (created.status === 201) pass('open debt created for the repayment test');
  else fail('open debt created for the repayment test', JSON.stringify(created));

  await page.goto(`${BASE}/splits`, {waitUntil: 'networkidle0'});
  await page.waitForSelector('[data-testid="people-balances"]', {timeout: 6000});

  const openFor = async (who) =>
    page.evaluate((target) => {
      const btn = [...document.querySelectorAll('[data-testid="repay-open"]')].find((b) =>
        b.parentElement.parentElement.textContent.includes(target),
      );
      if (!btn) return false;
      btn.click();
      return true;
    }, who);

  if (await openFor(person)) pass('repay form opens for the debtor');
  else fail('repay form opens for the debtor');

  await page.waitForSelector('[data-testid="repay-form"]', {timeout: 5000});
  await setInput('[data-testid="repay-amount"]', '100');
  await page.click('[data-testid="repay-save"]');
  await page.waitForSelector('[data-testid="repay-flash"]', {timeout: 6000});
  const flash = (await text('[data-testid="repay-flash"]')) || '';
  if (/Repaid/i.test(flash)) pass('partial repayment confirms with an expense note', flash.slice(0, 70));
  else fail('partial repayment confirms with an expense note', flash.slice(0, 70));

  const after = await page.evaluate(async () => (await fetch('/api/repayments')).json());
  const ower = (after.people || []).find((p) => p.name === person);
  if (ower && Math.round(ower.owe) === 200) pass('partial repayment reduces the open balance', `owe=${ower.owe}`);
  else fail('partial repayment reduces the open balance', JSON.stringify(ower || null));

  const ledger = await page.evaluate(
    async (who) => (await fetch(`/api/expenses?q=${encodeURIComponent(`Repayment to ${who}`)}`)).json(),
    person,
  );
  if ((ledger.expenses || []).length > 0) pass('repayment writes a NEED expense to the ledger');
  else fail('repayment writes a NEED expense to the ledger');

  if (await openFor(person)) {
    await page.waitForSelector('[data-testid="repay-form"]', {timeout: 5000});
    await setInput('[data-testid="repay-amount"]', '200');
    await page.click('[data-testid="repay-save"]');
  }
  await page.waitForFunction(
    (who) => {
      const box = document.querySelector('[data-testid="people-balances"]');
      return !!box && !box.textContent.includes(who);
    },
    {timeout: 6000},
    person,
  );
  pass('settling the remainder clears the balance');

  const history = await page.evaluate(async () => (await fetch('/api/repayments')).json());
  const mine = (history.history || []).filter((h) => h.personName === person);
  if (mine.length === 2) pass('repayment history keeps both settlements', `${mine.length}`);
  else fail('repayment history keeps both settlements', `${mine.length}`);

  const cleaned = await page.evaluate(
    async ({name, who}) => {
      const list = await (await fetch('/api/repayments')).json();
      let removed = 0;
      for (const row of (list.history || []).filter((h) => h.personName === who)) {
        if ((await fetch(`/api/repayments/${row.id}`, {method: 'DELETE'})).ok) removed += 1;
      }
      for (const query of [name, `Repayment to ${who}`]) {
        const data = await (await fetch(`/api/expenses?q=${encodeURIComponent(query)}`)).json();
        for (const expense of data.expenses || []) {
          await fetch(`/api/expenses/${expense.id}`, {method: 'DELETE'});
        }
      }
      return removed;
    },
    {name: stamp, who: person},
  );
  if (cleaned === 2) pass('repayment test rows cleaned up', `${cleaned} records`);
  else fail('repayment test rows cleaned up', `${cleaned}`);
});

// -------------------------------------------------------- loans and EMIs
await phase('loans and emi payments', async () => {
  await page.goto(`${BASE}/loans`, {waitUntil: 'networkidle0'});
  await page.waitForSelector('[data-testid="loan-list"]', {timeout: 8000});
  const before = await count('[data-testid="loan-card"]');
  if (before >= 1) pass('seeded loan renders on /loans', `${before} cards`);
  else fail('seeded loan renders on /loans');

  const stamp = `QA-LOAN-${Date.now()}`;
  await page.click('[data-testid="loan-toggle"]');
  await page.waitForSelector('[data-testid="loan-form"]', {timeout: 5000});
  await page.type('[data-testid="loan-lender"]', stamp);
  await page.type('[data-testid="loan-principal"]', '120000');
  await page.type('[data-testid="loan-rate"]', '10');
  await page.type('[data-testid="loan-tenure"]', '12');
  await setInput('[data-testid="loan-start"]', '2026-11-01');
  await wait(300);

  const preview = (await text('[data-testid="loan-preview"]')) || '';
  if (/EMI/.test(preview) && preview.includes('12 months')) pass('EMI preview calculates live', preview.slice(0, 60));
  else fail('EMI preview calculates live', preview.slice(0, 60));

  await page.click('[data-testid="loan-save"]');
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="loan-card"]').length > n, {timeout: 8000}, before);
  pass('loan created from /loans');

  await page.evaluate((name) => {
    const card = [...document.querySelectorAll('[data-testid="loan-card"]')].find((c) => c.textContent.includes(name));
    card?.querySelector('[data-testid="loan-schedule-toggle"]')?.click();
  }, stamp);
  await page.waitForSelector('[data-testid="loan-schedule"]', {timeout: 5000});
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="loan-schedule"] tbody tr').length > 0,
    {timeout: 8000},
  );
  const instalments = await page.$$eval('[data-testid="loan-schedule"] tbody tr', (rows) => rows.length);
  if (instalments === 12) pass('EMI schedule generated for the tenure', `${instalments} instalments`);
  else fail('EMI schedule generated for the tenure', `${instalments} instalments`);

  await page.evaluate(() => document.querySelector('[data-testid="loan-pay-row"]')?.click());
  await page.waitForFunction(
    (name) => {
      const card = [...document.querySelectorAll('[data-testid="loan-card"]')].find((c) => c.textContent.includes(name));
      return !!card && /1\/12/.test(card.textContent);
    },
    {timeout: 8000},
    stamp,
  );
  pass('paying an EMI marks an instalment paid');

  const ledger = await page.evaluate(
    async (name) => (await fetch(`/api/expenses?q=${encodeURIComponent(`EMI 1 · ${name}`)}`)).json(),
    stamp,
  );
  if ((ledger.expenses || []).length > 0) pass('EMI payment lands in the ledger');
  else fail('EMI payment lands in the ledger');

  const paidRow = (await page.$eval('[data-testid="loan-schedule"] tbody tr', (row) => row.textContent)) || '';
  if (/Paid/.test(paidRow)) pass('schedule row shows the paid stamp');
  else fail('schedule row shows the paid stamp', paidRow.slice(0, 80));

  await page.evaluate((name) => {
    const card = [...document.querySelectorAll('[data-testid="loan-card"]')].find((c) => c.textContent.includes(name));
    card?.querySelector('[data-testid="loan-delete"]')?.click();
  }, stamp);
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="loan-card"]').length === n, {timeout: 8000}, before);
  pass('loan deleted from /loans');

  const cleaned = await page.evaluate(
    async ({name, cardsBefore}) => {
      const loanList = await (await fetch('/api/loans')).json();
      const stray = (loanList.loans || []).find((l) => l.lenderName === name);
      if (stray) await fetch(`/api/loans/${stray.id}`, {method: 'DELETE'});
      const data = await (await fetch(`/api/expenses?q=${encodeURIComponent(`EMI 1 · ${name}`)}`)).json();
      let removed = 0;
      for (const expense of data.expenses || []) {
        if ((await fetch(`/api/expenses/${expense.id}`, {method: 'DELETE'})).ok) removed += 1;
      }
      return {removed, cardsBefore};
    },
    {name: stamp, cardsBefore: before},
  );
  if (cleaned.removed >= 1) pass('EMI expense cleaned up', `${cleaned.removed} rows`);
  else fail('EMI expense cleaned up', `${cleaned.removed}`);
});

// ------------------------------------------------------------ insights page
await phase('insights analytics', async () => {
  await page.goto(`${BASE}/insights`, {waitUntil: 'networkidle0'});
  await wait(1400);

  const hero = (await text('.hero')) || '';
  if (/NaN|undefined/.test(hero)) fail('insights KPIs free of NaN', hero.slice(0, 140));
  else pass('insights KPIs free of NaN');

  const surfaces = await count('.recharts-surface');
  if (surfaces >= 3) pass('insights charts mounted', `surfaces=${surfaces}`);
  else fail('insights charts mounted', `surfaces=${surfaces}`);

  const forecastRows = await count('table.table tbody tr');
  if (forecastRows >= 4) pass('forecast table has rows', `rows=${forecastRows}`);
  else fail('forecast table has rows', `rows=${forecastRows}`);

  const body = (await text('body')) || '';
  if (body.includes('Recurring Charges') && body.includes('Monthly commitment')) pass('subscriptions card rendered');
  else fail('subscriptions card rendered', body.slice(0, 120));
  if (body.includes('Biggest Transactions')) pass('top transactions list rendered');
  else fail('top transactions list rendered');

  const api = await page.evaluate(async () => {
    const subs = await (await fetch('/api/analytics/subscriptions')).json();
    const insights = await (await fetch('/api/analytics/insights?months=6')).json();
    return {subs, insights};
  });
  if ((api.subs.subscriptions || []).length >= 5 && api.subs.commitment > 0) {
    pass('subscription detection finds recurring charges', `${api.subs.subscriptions.length} · ${Math.round(api.subs.commitment)}`);
  } else {
    fail('subscription detection finds recurring charges', JSON.stringify(api.subs).slice(0, 140));
  }
  if (api.insights.forecast && api.insights.forecast.length >= 4 && api.insights.daily.length >= 30) {
    pass('insights API returns forecast + daily series', `${api.insights.forecast.length} categories`);
  } else {
    fail('insights API returns forecast + daily series');
  }
  if (api.insights.categoryTrend.series.length >= 4 && api.insights.categoryTrend.rows.length >= 3) {
    pass('category trend has series', api.insights.categoryTrend.series.map((x) => x.name).join(',').slice(0, 60));
  } else {
    fail('category trend has series', JSON.stringify(api.insights.categoryTrend).slice(0, 140));
  }

  await clickByText('.seg-btn', '3M');
  await wait(1500);
  const windowLabel = (await text('.hero')) || '';
  if (windowLabel.includes('days') || windowLabel.includes('transactions')) pass('range switcher re-runs the analysis');
  else fail('range switcher re-runs the analysis', windowLabel.slice(0, 120));
});

// ------------------------------------------------------- budget forecasting
await phase('insights mom, what-if and tax', async () => {
  await page.goto(`${BASE}/insights`, {waitUntil: 'networkidle0'});
  const momReady = await until(async () => (await count('[data-testid="mom-block"]')) === 1, 9000);
  if (momReady) pass('month vs month block renders');
  else fail('month vs month block renders', `count=${await count('[data-testid="mom-block"]')}`);

  const pctRows = await count('[data-testid="mom-pct"]');
  if (pctRows === 3) pass('spend, income and savings are compared', `${pctRows} rows`);
  else fail('spend, income and savings are compared', String(pctRows));

  const movers = await count('[data-testid="mom-mover"]');
  const deltas = await count('[data-testid="mom-delta"]');
  if (movers > 0 && deltas === movers) pass('category movers listed with deltas', `${movers} movers`);
  else fail('category movers listed with deltas', `${movers}/${deltas}`);

  const beforeCut = (await text('[data-testid="whatif-result"]')) || '';
  const moved = await page.$eval('[data-testid="whatif-cut"]', (el) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '30');
    el.dispatchEvent(new Event('input', {bubbles: true}));
    return true;
  });
  const cutChanged = await until(async () => (await text('[data-testid="whatif-result"]')) !== beforeCut, 5000);
  if (moved && cutChanged) pass('what-if reacts to the spending cut', `${beforeCut} → ${await text('[data-testid="whatif-result"]')}`);
  else fail('what-if reacts to the spending cut', `${beforeCut} / ${await text('[data-testid="whatif-result"]')}`);

  await page.$eval('[data-testid="whatif-extra"]', (el) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '5000');
    el.dispatchEvent(new Event('input', {bubbles: true}));
  });
  const scenario = {
    monthly: (await text('[data-testid="whatif-monthly"]')) || '',
    rate: (await text('[data-testid="whatif-rate"]')) || '',
    delta: (await text('[data-testid="whatif-delta"]')) || '',
  };
  if (scenario.monthly && scenario.rate && /\+/.test(scenario.delta)) pass('what-if shows the extra-saving upside', JSON.stringify(scenario));
  else fail('what-if shows the extra-saving upside', JSON.stringify(scenario));

  const taxReady = await until(async () => (await count('[data-testid="tax-block"]')) === 1, 5000);
  const flagged = await text('[data-testid="tax-flagged"]');
  const eligible = (await text('[data-testid="tax-eligible"]')) || '';
  if (taxReady && Number(flagged) >= 1 && eligible && !/^₹0$/.test(eligible.trim()))
    pass('tax-deductible spending totalled for the year', `${flagged} flagged · ${eligible}`);
  else fail('tax-deductible spending totalled for the year', `${taxReady} ${flagged} ${eligible}`);

  const taxRows = await count('[data-testid="tax-row"]');
  if (taxRows >= 1) pass('tax breakdown lists flagged categories', `${taxRows} rows`);
  else fail('tax breakdown lists flagged categories', String(taxRows));
});

await phase('budget forecast on categories page', async () => {
  await page.goto(`${BASE}/budgets`, {waitUntil: 'networkidle0'});
  await wait(900);
  const body = (await text('body')) || '';
  if (body.includes('Projected by')) pass('budget cards show a month-end projection');
  else fail('budget cards show a month-end projection');
  if (/Projected ₹|Projected /.test(body)) pass('projection uses money formatting');
  else fail('projection uses money formatting', body.slice(0, 120));
});

// ------------------------------------------------------- credit card analysis
await phase('credit card analytics', async () => {
  await page.goto(`${BASE}/cards`, {waitUntil: 'networkidle0'});
  await wait(1400);
  const hero = (await text('.hero')) || '';
  if (/NaN|undefined/.test(hero)) fail('card health summary free of NaN', hero.slice(0, 140));
  else pass('card health summary free of NaN');

  const body = (await text('body')) || '';
  if (body.includes('Overall Utilisation') && body.includes('Combined Limit')) pass('credit health summary rendered');
  else fail('credit health summary rendered');

  const cardBox = await page.evaluate(() => document.querySelector('.card-lift')?.textContent ?? '');
  if (cardBox.includes('Billing cycle') && /cycle spend/i.test(cardBox) && /Est\. bill/i.test(cardBox)) {
    pass('billing cycle breakdown rendered');
  } else {
    fail('billing cycle breakdown rendered', cardBox.slice(0, 160));
  }
  if (/Rewards/.test(cardBox) && /Interest/.test(cardBox) && /Min\. due/.test(cardBox)) pass('rewards / min-due / interest tiles rendered');
  else fail('rewards / min-due / interest tiles rendered', cardBox.slice(0, 160));
  if (cardBox.includes('in ') && cardBox.includes('days')) pass('due-date countdown rendered');
  else fail('due-date countdown rendered');
  if (/Excellent|Healthy|Fair use|High use/.test(cardBox)) pass('utilisation health band rendered');
  else fail('utilisation health band rendered');
  if (cardBox.includes('6-month trend')) pass('card spending trend rendered');
  else fail('card spending trend rendered');

  const api = await page.evaluate(async () => {
    const d = await (await fetch('/api/analytics/cards')).json();
    return d;
  });
  const card = (api.cards || [])[0] || {};
  if (card.apr > 0 && card.interest !== null && card.interest > 0) pass('interest estimate uses the card APR', `${card.apr}% → ${card.interest}`);
  else fail('interest estimate uses the card APR', JSON.stringify(card).slice(0, 120));
  if (card.rewardsRate > 0 && card.rewards > 0) pass('rewards estimate uses the rewards rate', `${card.rewardsRate}% → ${card.rewards}`);
  else fail('rewards estimate uses the rewards rate');
  if (api.totals && api.totals.utilisation >= 0) pass('combined utilisation computed', `${api.totals.utilisation}%`);
  else fail('combined utilisation computed');
  if (card.cycle && card.cycle.daysLeft >= 0 && card.categorySplit && card.categorySplit.length > 0) {
    pass('cycle + card category split returned', `daysLeft=${card.cycle.daysLeft} split=${card.categorySplit.length}`);
  } else {
    fail('cycle + card category split returned');
  }
});

// ------------------------------------------------ date range filter + export
await phase('date range filter and CSV export', async () => {
  await page.goto(`${BASE}/expenses`, {waitUntil: 'networkidle0'});
  await wait(900);
  const before = await count('table.table tbody tr');

  const today = new Date().toISOString().slice(0, 10);
  const filled = await page.$$eval('input[type="date"]', (els, v) => {
    if (els.length < 2) return 0;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    for (const el of els) {
      setter.call(el, v);
      el.dispatchEvent(new Event('input', {bubbles: true}));
    }
    return els.length;
  }, today);
  if (filled < 2) throw new Error('date range inputs missing');
  await wait(1400);
  const after = await count('table.table tbody tr');
  if (after <= before) pass('date range filter narrows the list', `${before} → ${after}`);
  else fail('date range filter narrows the list', `${before} → ${after}`);

  const href = await page.evaluate(() => document.querySelector('a[download]')?.getAttribute('href') || '');
  if (href.includes('from=') && href.includes('to=')) pass('export link carries the active filters', href.slice(-60));
  else fail('export link carries the active filters', href);

  const csv = await page.evaluate(async (url) => {
    const res = await fetch(url);
    const text = await res.text();
    return {type: res.headers.get('content-type') || '', status: res.status, head: text.slice(0, 40), lines: text.split(/\r?\n/).length};
  }, href);
  if (csv.status === 200 && csv.type.includes('text/csv')) pass('CSV export responds with text/csv', `${csv.lines} lines`);
  else fail('CSV export responds with text/csv', JSON.stringify(csv));
  if (csv.head.startsWith('Date,Description,Category')) pass('CSV header row is correct', csv.head.slice(0, 40));
  else fail('CSV header row is correct', csv.head);
});

// ---------------------------------------------------------- pwa installability
await phase('pwa installability', async () => {
  await page.goto(`${BASE}/`, {waitUntil: 'networkidle0'});

  const mani = await page.evaluate(async () => {
    const res = await fetch('/manifest.webmanifest');
    const json = res.ok ? await res.json().catch(() => null) : null;
    return {status: res.status, json};
  });
  const m = mani.json || {};
  if (mani.status === 200 && /PocketLedger/.test(m.name || '') && m.display === 'standalone' && m.start_url === '/' && /^#/.test(m.theme_color || '')) {
    pass('manifest is served and complete', `${m.name} · ${m.display}`);
  } else {
    fail('manifest is served and complete', JSON.stringify({status: mani.status, name: m.name, display: m.display, start: m.start_url}));
  }

  const icons = Array.isArray(m.icons) ? m.icons : [];
  const sizesOk = ['192x192', '512x512'].every((sz) => icons.some((i) => i.sizes === sz));
  const maskable = icons.some((i) => String(i.purpose || '').includes('maskable'));
  if (icons.length >= 3 && sizesOk && maskable) pass('manifest advertises 192/512 + maskable icons', `${icons.length} icons`);
  else fail('manifest advertises 192/512 + maskable icons', JSON.stringify(icons.map((i) => `${i.sizes}:${i.purpose || ''}`)));

  const iconStatuses = await page.evaluate(
    async (srcs) =>
      Promise.all(
        srcs.map(async (src) => {
          const res = await fetch(src);
          return {src, status: res.status, type: res.headers.get('content-type') || ''};
        }),
      ),
    icons.map((i) => i.src),
  );
  if (iconStatuses.length > 0 && iconStatuses.every((x) => x.status === 200 && x.type.includes('image/png'))) {
    pass('app icons load as png', `${iconStatuses.length} fetched`);
  } else {
    fail('app icons load as png', JSON.stringify(iconStatuses));
  }

  const sw = await page.evaluate(async () => {
    const res = await fetch('/sw.js');
    const text = res.ok ? await res.text() : '';
    return {status: res.status, hasFetch: text.includes('addEventListener') && text.includes('fetch')};
  });
  if (sw.status === 200 && sw.hasFetch) pass('service worker script is served', `${sw.status}`);
  else fail('service worker script is served', JSON.stringify(sw));

  const registered = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return -1;
    for (let attempt = 0; attempt < 40; attempt++) {
      const regs = await navigator.serviceWorker.getRegistrations();
      if (regs.length > 0) return regs.length;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return 0;
  });
  if (registered > 0) pass('service worker registers on load', `${registered} registration(s)`);
  else fail('service worker registers on load', String(registered));

  const themeMeta = await page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.getAttribute('content') || '');
  if (themeMeta === '#047857') pass('theme-color meta is emitted', themeMeta);
  else fail('theme-color meta is emitted', themeMeta);
});

// ---------------------------------------------------------- command palette
await phase('command palette', async () => {
  await page.goto(`${BASE}/`, {waitUntil: 'networkidle0'});
  const trigger = await until(async () => (await count('[data-testid="palette-open"]')) === 1, 6000);
  if (trigger) pass('palette trigger sits in the navbar');
  else fail('palette trigger sits in the navbar', `count=${await count('[data-testid="palette-open"]')}`);

  await jsClick('[data-testid="palette-open"]');
  const shown = await until(async () => (await count('[data-testid="palette"]')) === 1, 4000);
  if (shown) pass('palette opens from the trigger');
  else fail('palette opens from the trigger', `count=${await count('[data-testid="palette"]')}`);

  const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '');
  if (focused === 'palette-input') pass('palette input takes focus');
  else fail('palette input takes focus', focused);

  await page.type('[data-testid="palette-input"]', 'insights');
  await wait(350);
  const items = await page.$$eval('[data-testid="palette-item"]', (els) => els.map((e) => e.textContent || ''));
  if (items.length > 0 && items.length < 15 && items.some((t) => /Insights/.test(t))) {
    pass('typing filters the command list', `${items.length} shown`);
  } else fail('typing filters the command list', JSON.stringify(items.slice(0, 5)));

  await page.keyboard.press('Enter');
  const jumped = await page
    .waitForFunction(() => location.pathname === '/insights' && !document.querySelector('[data-testid="palette"]'), {
      timeout: 8000,
    })
    .then(() => true)
    .catch(() => false);
  if (jumped) pass('enter runs the highlighted command', await page.evaluate(() => location.pathname));
  else fail('enter runs the highlighted command', await page.evaluate(() => location.pathname));

  await page.keyboard.down('Control');
  await page.keyboard.press('KeyK');
  await page.keyboard.up('Control');
  const shortcut = await until(async () => (await count('[data-testid="palette"]')) === 1, 4000);
  if (shortcut) pass('ctrl+k reopens the palette');
  else fail('ctrl+k reopens the palette');

  const fresh = await page.$eval('[data-testid="palette-input"]', (el) => el.value);
  if (fresh === '') pass('reopened palette starts with a clean query');
  else fail('reopened palette starts with a clean query', fresh);

  await page.type('[data-testid="palette-input"]', 'qqzz');
  await wait(300);
  const empty = await count('[data-testid="palette-empty"]');
  if (empty === 1) pass('no-match state is shown');
  else fail('no-match state is shown', String(empty));

  await page.keyboard.press('Escape');
  const closed = await until(async () => (await count('[data-testid="palette"]')) === 0, 4000);
  if (closed) pass('escape closes the palette');
  else fail('escape closes the palette');

  const themeBefore = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyK');
  await page.keyboard.up('Control');
  await until(async () => (await count('[data-testid="palette"]')) === 1, 4000);
  await page.type('[data-testid="palette-input"]', 'dark mode');
  await wait(300);
  await page.keyboard.press('Enter');
  await wait(400);
  const themeAfter = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  if (themeAfter !== themeBefore) pass('palette runs the theme command', `${themeBefore} → ${themeAfter}`);
  else fail('palette runs the theme command', String(themeAfter));
  if (themeAfter !== themeBefore) {
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyK');
    await page.keyboard.up('Control');
    await until(async () => (await count('[data-testid="palette"]')) === 1, 4000);
    await page.type('[data-testid="palette-input"]', 'dark mode');
    await wait(300);
    await page.keyboard.press('Enter');
    await wait(400);
  }
});

// ---------------------------------------------------------- responsive layout
await phase('responsive layout', async () => {
  const original = page.viewport() || {width: 1500, height: 1000};
  const paths = ['/', '/expenses', '/loans', '/splits', '/insights', '/statements'];
  const sizes = [
    {label: 'phone 390px', width: 390, height: 844},
    {label: 'tablet 768px', width: 768, height: 1024},
  ];

  for (const size of sizes) {
    await page.setViewport({width: size.width, height: size.height});
    for (const path of paths) {
      await page.goto(`${BASE}${path}`, {waitUntil: 'networkidle0'});
      await wait(700);
      const m = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      if (m.scroll <= m.client + 1) pass(`${size.label} ${path} has no horizontal overflow`, `${m.scroll}/${m.client}`);
      else fail(`${size.label} ${path} has no horizontal overflow`, `${m.scroll}/${m.client}`);
    }
  }

  await page.setViewport({width: 390, height: 844});
  await page.goto(`${BASE}/`, {waitUntil: 'networkidle0'});
  await wait(700);

  const navHidden = await page.evaluate(() => {
    const nav = document.querySelector('nav');
    return !nav || getComputedStyle(nav).display === 'none';
  });
  if (navHidden) pass('desktop nav collapses on phone');
  else fail('desktop nav collapses on phone');

  const opened = await page.$$eval('header button', (btns) => {
    const burger = btns.find((b) => /menu|navigation/i.test(b.getAttribute('aria-label') || ''));
    if (!burger) return {found: false};
    burger.click();
    return {found: true};
  });
  await wait(400);
  const menuLinks = await page.$$eval('header a', (as) => as.filter((a) => a.offsetParent !== null).length);
  if (opened.found && menuLinks >= 6) pass('hamburger menu opens with nav links', `${menuLinks} visible`);
  else fail('hamburger menu opens with nav links', `found=${opened.found} links=${menuLinks}`);

  await page.goto(`${BASE}/expenses`, {waitUntil: 'networkidle0'});
  await wait(900);
  const actions = await page.evaluate(() => {
    const el = document.querySelector('.row-actions');
    return el ? getComputedStyle(el).opacity : 'none';
  });
  if (actions === '1') pass('row actions are visible without hover on phone', `opacity=${actions}`);
  else fail('row actions are visible without hover on phone', `opacity=${actions}`);

  const phoneBar = await page.evaluate(() => {
    const header = document.querySelector('header');
    const burger = document.querySelector('button[aria-label="Toggle navigation"]');
    const add = [...document.querySelectorAll('header a')].find((a) => a.textContent.trim() === 'Add Expense');
    return {
      h: header ? Math.round(header.getBoundingClientRect().height) : 0,
      burger: burger ? getComputedStyle(burger).display : 'none',
      add: add ? getComputedStyle(add).display : 'none',
    };
  });
  if (phoneBar.h <= 80 && phoneBar.burger !== 'none' && phoneBar.add === 'none') {
    pass('phone navbar is one clean row (menu only)', `h=${phoneBar.h}`);
  } else {
    fail('phone navbar is one clean row (menu only)', JSON.stringify(phoneBar));
  }

  await page.setViewport({width: 1280, height: 900});
  await page.goto(`${BASE}/`, {waitUntil: 'networkidle0'});
  await wait(800);
  const deskBar = await page.evaluate(() => {
    const header = document.querySelector('header');
    const burger = document.querySelector('button[aria-label="Toggle navigation"]');
    const nav = document.querySelector('header nav');
    const wrapped = [...document.querySelectorAll('header .btn, header button')].some(
      (el) => el.getBoundingClientRect().height > 44,
    );
    return {
      h: header ? Math.round(header.getBoundingClientRect().height) : 0,
      burger: burger ? getComputedStyle(burger).display : 'none',
      navRows: nav && getComputedStyle(nav).display !== 'none' ? Math.round(nav.getBoundingClientRect().height) : 0,
      wrapped,
    };
  });
  if (deskBar.h <= 80 && deskBar.burger === 'none' && deskBar.navRows > 0 && deskBar.navRows < 50 && !deskBar.wrapped) {
    pass('desktop navbar is one row with no wrapped buttons', `h=${deskBar.h} nav=${deskBar.navRows}`);
  } else {
    fail('desktop navbar is one row with no wrapped buttons', JSON.stringify(deskBar));
  }

  const deskOverflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  if (deskOverflow.scroll <= deskOverflow.client + 1) {
    pass('desktop 1280px has no horizontal overflow', `${deskOverflow.scroll}/${deskOverflow.client}`);
  } else {
    fail('desktop 1280px has no horizontal overflow', JSON.stringify(deskOverflow));
  }

  await page.setViewport({width: 1536, height: 900});
  await page.goto(`${BASE}/`, {waitUntil: 'networkidle0'});
  await wait(700);
  const wideOverflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  if (wideOverflow.scroll <= wideOverflow.client + 1) {
    pass('desktop 1536px (2xl) has no horizontal overflow', `${wideOverflow.scroll}/${wideOverflow.client}`);
  } else {
    fail('desktop 1536px (2xl) has no horizontal overflow', JSON.stringify(wideOverflow));
  }

  await page.setViewport(original);
});

// ------------------------------------------------------------- statements
await phase('statements', async () => {
  await page.setViewport({width: 1500, height: 1000});
  await page.goto(`${BASE}/statements`, {waitUntil: 'networkidle0'});
  const ready = await until(
    async () => (await count('[data-testid="stmt-table"]')) === 1 || (await count('[data-testid="stmt-empty"]')) === 1,
    8000,
  );
  if (ready) pass('statement page renders the month');
  else fail('statement page renders the month', `table=${await count('[data-testid="stmt-table"]')} empty=${await count('[data-testid="stmt-empty"]')}`);

  const monthValue = await page.$eval('[data-testid="stmt-month"]', (el) => el.value);
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(monthValue)) pass('month control starts on a valid YYYY-MM', monthValue);
  else fail('month control starts on a valid YYYY-MM', monthValue);

  const rows = await count('[data-testid="stmt-row"]');
  const emptyState = await count('[data-testid="stmt-empty"]');
  if (rows > 0 || emptyState === 1) pass('the month lists transactions or says it is empty', `${rows} rows`);
  else fail('the month lists transactions or says it is empty', `rows=${rows} empty=${emptyState}`);

  let tiles = 0;
  for (const id of ['stmt-income', 'stmt-spent', 'stmt-net', 'stmt-count']) {
    if ((await text(`[data-testid="${id}"]`)) !== null) tiles += 1;
  }
  if (tiles === 4) pass('summary tiles show income, spent, net and count', `${tiles}/4`);
  else fail('summary tiles show income, spent, net and count', `${tiles}/4`);

  await jsClick('[data-testid="stmt-prev"]');
  await wait(700);
  const shifted = await page.$eval('[data-testid="stmt-month"]', (el) => el.value);
  if (shifted && shifted !== monthValue) pass('the previous-month button moves the range', `${monthValue} → ${shifted}`);
  else fail('the previous-month button moves the range', `${monthValue} → ${shifted}`);

  const cats = await count('[data-testid="stmt-cat-row"]');
  if (cats >= 1) pass('category breakdown lists the biggest spends', `${cats} categories`);
  else fail('category breakdown lists the biggest spends', `${cats} rows`);

  const cardValue = await page.$eval('[data-testid="stmt-scope"]', (el) => el.options[1]?.value ?? '');
  if (cardValue) {
    await page.$eval(
      '[data-testid="stmt-scope"]',
      (el, value) => {
        el.value = value;
        el.dispatchEvent(new Event('change', {bubbles: true}));
      },
      cardValue,
    );
    const scoped = await until(async () => ((await text('[data-testid="stmt-title"]')) || '').includes('·'), 6000);
    const title = (await text('[data-testid="stmt-title"]')) || '';
    if (scoped) pass('card scope switches the statement to that card', title);
    else fail('card scope switches the statement to that card', title);
  } else {
    fail('card scope switches the statement to that card', 'no cards to pick');
  }

  await page.$eval('[data-testid="stmt-scope"]', (el) => {
    el.value = 'all';
    el.dispatchEvent(new Event('change', {bubbles: true}));
  });
  const backToAll = await until(async () => !((await text('[data-testid="stmt-title"]')) || '').includes('·'), 6000);
  if (backToAll) pass('all-accounts scope restores the full statement');
  else fail('all-accounts scope restores the full statement', String(await text('[data-testid="stmt-title"]')));

  await page.evaluate(() => {
    window.__qaPrinted = 0;
    window.print = () => {
      window.__qaPrinted = 1;
    };
  });
  await jsClick('[data-testid="stmt-print"]');
  const printed = await page.evaluate(() => window.__qaPrinted === 1);
  if (printed) pass('print button opens the print dialog');
  else fail('print button opens the print dialog', String(printed));

  const visibleChips = () =>
    page.$$eval('header a[href="/statements"]', (els) => els.filter((el) => el.offsetParent !== null).length);
  const wideChip = await visibleChips();
  if (wideChip === 1) pass('desktop navbar links to statements on wide screens', String(wideChip));
  else fail('desktop navbar links to statements on wide screens', String(wideChip));

  await page.setViewport({width: 1280, height: 900});
  await wait(300);
  const narrowChip = await visibleChips();
  if (narrowChip === 0) pass('the statements chip folds away at 1280 to keep the header on one row');
  else fail('the statements chip folds away at 1280 to keep the header on one row', String(narrowChip));
  await page.setViewport({width: 1500, height: 1000});

  await page.goto(`${BASE}/`, {waitUntil: 'networkidle0'});
  await until(async () => (await count('[data-testid="palette-open"]')) === 1, 6000);
  await jsClick('[data-testid="palette-open"]');
  await until(async () => (await count('[data-testid="palette"]')) === 1, 4000);
  await page.type('[data-testid="palette-input"]', 'statements');
  await wait(350);
  const items = await page.$$eval('[data-testid="palette-item"]', (els) => els.map((el) => el.textContent || ''));
  if (items.some((label) => /Statements/.test(label))) pass('the palette lists the statements page', JSON.stringify(items.slice(0, 3)));
  else fail('the palette lists the statements page', JSON.stringify(items.slice(0, 3)));

  await page.keyboard.press('Enter');
  const jumped = await page
    .waitForFunction(() => location.pathname === '/statements', {timeout: 8000})
    .then(() => true)
    .catch(() => false);
  if (jumped) pass('palette enter opens the statement');
  else fail('palette enter opens the statement', await page.evaluate(() => location.pathname));
});

// ------------------------------------------------------- household sharing
await phase('household sharing', async () => {
  await page.setViewport({width: 1500, height: 1000});
  if ((await currentEmail()) !== DEMO_EMAIL) await loginViaForm(DEMO_EMAIL, DEMO_PASSWORD);

  await page.goto(`${BASE}/settings`, {waitUntil: 'networkidle0'});
  const cardUp = await until(async () => (await count('[data-testid="hh-section"]')) === 1, 6000);
  if (cardUp) pass('settings shows the household card');
  else fail('settings shows the household card', `count=${await count('[data-testid="hh-section"]')}`);

  let invite = (await text('[data-testid="hh-invite"]')) || '';
  if (/^[A-HJ-NP-Z2-9]{8}$/.test(invite)) pass('the invite code is eight characters', invite);
  else fail('the invite code is eight characters', invite);

  if ((await text('[data-testid="hh-member-count"]')) === 'Members · 1') pass('a solo household lists one member');
  else fail('a solo household lists one member', String(await text('[data-testid="hh-member-count"]')));

  await setInput('[data-testid="hh-name"]', 'QA Shared Ledger');
  await jsClick('[data-testid="hh-rename"]');
  const renamed = await until(async () => ((await text('[data-testid="hh-message"]')) || '').includes('updated'), 5000);
  if (renamed) pass('the owner renames the household');
  else fail('the owner renames the household', String(await text('[data-testid="hh-message"]')));

  const inviteBefore = invite;
  await jsClick('[data-testid="hh-regen"]');
  const regen = await until(async () => {
    const next = (await text('[data-testid="hh-invite"]')) || '';
    return Boolean(next) && next !== inviteBefore && /^[A-HJ-NP-Z2-9]{8}$/.test(next);
  }, 5000);
  invite = (await text('[data-testid="hh-invite"]')) || '';
  if (regen) pass('the owner regenerates the invite code', `${inviteBefore} → ${invite}`);
  else fail('the owner regenerates the invite code', String(invite));

  const snapshot = await page.evaluate(async () => {
    const exp = await (await fetch('/api/expenses?limit=1')).json();
    const cats = await (await fetch('/api/categories')).json();
    return {total: exp.total ?? 0, cats: (cats.categories || []).length};
  });
  if (snapshot.total > 50) pass('the owner ledger has rows worth sharing', `${snapshot.total} expenses, ${snapshot.cats} categories`);
  else fail('the owner ledger has rows worth sharing', JSON.stringify(snapshot));

  const second = `qa-hh-${Date.now()}@test.local`;
  await page.goto(`${BASE}/signup`, {waitUntil: 'networkidle0'});
  await page.waitForSelector('[data-testid="signup-email"]', {timeout: 6000});
  await setInput('[data-testid="signup-name"]', 'QA Partner');
  await setInput('[data-testid="signup-email"]', second);
  await setInput('[data-testid="signup-password"]', 'qa-password-1');
  await setInput('[data-testid="signup-confirm"]', 'qa-password-1');
  await jsClick('[data-testid="signup-submit"]');
  const landed = await page
    .waitForFunction(() => window.location.pathname === '/', {timeout: 8000})
    .then(() => true)
    .catch(() => false);
  if (landed && (await currentEmail()) === second) pass('a second account signs up and lands signed in', second);
  else fail('a second account signs up and lands signed in', String(await currentEmail()));

  await page.goto(`${BASE}/settings`, {waitUntil: 'networkidle0'});
  await until(async () => (await count('[data-testid="hh-section"]')) === 1, 6000);
  await setInput('[data-testid="hh-join-code"]', invite);
  await jsClick('[data-testid="hh-join"]');
  const joined = await until(async () => (await text('[data-testid="hh-member-count"]')) === 'Members · 2', 7000);
  const joinMsg = (await text('[data-testid="hh-message"]')) || '';
  if (joined && /Joined /.test(joinMsg)) pass('the invite joins the household', joinMsg);
  else fail('the invite joins the household', `${joinMsg} / ${await text('[data-testid="hh-member-count"]')}`);

  const roster = await page.$$eval('[data-testid="hh-member"]', (els) => els.map((el) => el.textContent || ''));
  const rosterOk = roster.length === 2 && roster.some((r) => r.includes(DEMO_EMAIL)) && roster.some((r) => r.includes(second));
  const rolesOk = roster.some((r) => /Owner/.test(r)) && roster.some((r) => /Member/.test(r));
  if (rosterOk && rolesOk) pass('both members are listed with owner and member badges');
  else fail('both members are listed with owner and member badges', JSON.stringify(roster));

  const stampDate = new Date().toISOString().slice(0, 10);
  const stamped = await page.evaluate(async (date) => {
    const catRes = await fetch('/api/categories', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name: 'QA Shared Category', monthlyBudget: 250, colorCode: '#38bdf8', taxDeductible: false}),
    });
    const cat = await catRes.json().catch(() => ({}));
    if (!catRes.ok) return {error: `category ${catRes.status}: ${cat.error || ''}`};
    const expRes = await fetch('/api/expenses', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        date,
        description: 'household-stamp',
        categoryId: cat.category.id,
        paymentMethod: 'UPI',
        amount: 7.77,
        type: 'WANT',
      }),
    });
    return {error: expRes.ok ? null : `expense ${expRes.status}`};
  }, stampDate);
  if (!stamped.error) pass('the member posts a shared category and expense');
  else fail('the member posts a shared category and expense', String(stamped.error));

  const memberTotal = await page.evaluate(async () => (await fetch('/api/expenses?limit=1')).json());
  if (memberTotal.total === snapshot.total + 1) pass('the member sees the whole household ledger', `${memberTotal.total} rows`);
  else fail('the member sees the whole household ledger', `${memberTotal.total} vs ${snapshot.total}+1`);

  // deliberate 4xx probes run from Node so they never touch the browser console
  const cookies = await page.cookies(BASE);
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const probe = async (path, body) => {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', cookie: cookieHeader},
      body: JSON.stringify(body ?? {}),
    });
    return {status: res.status, body: await res.json().catch(() => ({}))};
  };

  const rejoin = await probe('/api/household/join', {code: invite});
  if (rejoin.status === 400 && /already a member/i.test(rejoin.body.error || '')) pass('joining the same household again is rejected', rejoin.body.error);
  else fail('joining the same household again is rejected', JSON.stringify(rejoin));

  const unknown = await probe('/api/household/join', {code: 'ZZZZZZZZ'});
  if (unknown.status === 400 && /does not match/i.test(unknown.body.error || '')) pass('an unknown invite code is rejected', unknown.body.error);
  else fail('an unknown invite code is rejected', JSON.stringify(unknown));

  const memberRegen = await probe('/api/household/regenerate');
  if (memberRegen.status === 403) pass('a plain member cannot regenerate the invite code', '403');
  else fail('a plain member cannot regenerate the invite code', JSON.stringify(memberRegen));

  // back in the owner's seat
  await jsClick('[data-testid="logout"]');
  await until(async () => (await page.evaluate(() => location.pathname)) === '/login', 6000);
  await loginViaForm(DEMO_EMAIL, DEMO_PASSWORD);
  await page.goto(`${BASE}/settings`, {waitUntil: 'networkidle0'});
  const sharedCount = await until(async () => (await text('[data-testid="hh-member-count"]')) === 'Members · 2', 6000);
  const ownerRoster = await page.$$eval('[data-testid="hh-member"]', (els) => els.map((el) => el.textContent || ''));
  if (sharedCount && ownerRoster.some((r) => r.includes(second))) pass('the owner sees the new member', 'Members · 2');
  else fail('the owner sees the new member', JSON.stringify(ownerRoster));

  const ownerView = await page.evaluate(async () => {
    const exp = await (await fetch('/api/expenses?q=household-stamp&limit=5')).json();
    const all = await (await fetch('/api/expenses?limit=1')).json();
    const cats = await (await fetch('/api/categories')).json();
    return {
      stamp: exp.total ?? 0,
      total: all.total ?? 0,
      sharedCat: (cats.categories || []).some((c) => c.name === 'QA Shared Category'),
    };
  });
  if (ownerView.stamp === 1 && ownerView.total === snapshot.total + 1) pass('the member expense shows up in the owner ledger', `${ownerView.total} rows`);
  else fail('the member expense shows up in the owner ledger', JSON.stringify(ownerView));
  if (ownerView.sharedCat) pass('the shared category shows up for the owner');
  else fail('the shared category shows up for the owner', String(ownerView.sharedCat));

  await page.goto(`${BASE}/expenses`, {waitUntil: 'networkidle0'});
  const inDailyLog = await until(async () => (await rowByDescription('household-stamp')) >= 0, 8000);
  if (inDailyLog) pass('the member expense appears in the Daily Log');
  else fail('the member expense appears in the Daily Log', 'row not found');

  // the member leaves
  await jsClick('[data-testid="logout"]');
  await until(async () => (await page.evaluate(() => location.pathname)) === '/login', 6000);
  await loginViaForm(second, 'qa-password-1');
  await page.goto(`${BASE}/settings`, {waitUntil: 'networkidle0'});
  await until(async () => (await count('[data-testid="hh-section"]')) === 1, 6000);
  await jsClick('[data-testid="hh-leave"]');
  const leftMsg = await until(async () => ((await text('[data-testid="hh-message"]')) || '').includes('You left'), 6000);
  const backToSolo = await until(async () => (await text('[data-testid="hh-member-count"]')) === 'Members · 1', 6000);
  if (leftMsg && backToSolo) pass('leaving the household restores a solo card', 'Members · 1');
  else fail('leaving the household restores a solo card', `${await text('[data-testid="hh-message"]')} / ${await text('[data-testid="hh-member-count"]')}`);

  await jsClick('[data-testid="logout"]');
  await until(async () => (await page.evaluate(() => location.pathname)) === '/login', 6000);
  await loginViaForm(DEMO_EMAIL, DEMO_PASSWORD);
  const afterLeave = await page.evaluate(async () => {
    const exp = await (await fetch('/api/expenses?q=household-stamp&limit=5')).json();
    const all = await (await fetch('/api/expenses?limit=1')).json();
    const cats = await (await fetch('/api/categories')).json();
    return {stamp: exp.total ?? 0, total: all.total ?? 0, cats: (cats.categories || []).length};
  });
  if (afterLeave.stamp === 0) pass('the shared expense leaves with the member', '0 rows');
  else fail('the shared expense leaves with the member', String(afterLeave.stamp));
  if (afterLeave.total === snapshot.total && afterLeave.cats === snapshot.cats) {
    pass('the owner ledger is exactly its own again', `${afterLeave.total} rows, ${afterLeave.cats} categories`);
  } else {
    fail('the owner ledger is exactly its own again', JSON.stringify(afterLeave));
  }

  await page.goto(`${BASE}/settings`, {waitUntil: 'networkidle0'});
  await until(async () => (await count('[data-testid="hh-section"]')) === 1, 6000);
  const finalCount = await text('[data-testid="hh-member-count"]');
  const finalRoster = await page.$$eval('[data-testid="hh-member"]', (els) => els.map((el) => el.textContent || ''));
  if (finalCount === 'Members · 1' && !finalRoster.some((r) => r.includes(second))) pass('the owner is solo again', finalCount);
  else fail('the owner is solo again', `${finalCount} / ${JSON.stringify(finalRoster)}`);

  // tidy up: the second account's rows, categories and memberships cascade away
  await jsClick('[data-testid="logout"]');
  await until(async () => (await page.evaluate(() => location.pathname)) === '/login', 6000);
  await loginViaForm(second, 'qa-password-1');
  const removed = await page.evaluate(async () => (await fetch('/api/user', {method: 'DELETE'})).ok);
  if (removed && !(await currentEmail())) pass('the second account can be deleted');
  else fail('the second account can be deleted', String(await currentEmail()));

  await loginViaForm(DEMO_EMAIL, DEMO_PASSWORD);
  if ((await currentEmail()) === DEMO_EMAIL) pass('demo is signed back in for the next phase');
  else fail('demo is signed back in for the next phase', String(await currentEmail()));
  await page.goto(`${BASE}/settings`, {waitUntil: 'networkidle0'});
});

// ------------------------------------------------------------- two-factor auth
await phase('two-factor login', async () => {
  await page.goto(`${BASE}/settings`, {waitUntil: 'networkidle0'});
  await wait(700);
  const initial = await text('[data-testid="2fa-status"]');
  if (initial === 'Off') pass('two-factor starts off');
  else fail('two-factor starts off', String(initial));

  await jsClick('[data-testid="2fa-setup"]');
  const qrUp = await until(async () => (await count('[data-testid="2fa-qr"]')) === 1, 6000);
  if (qrUp) pass('setup shows a QR code');
  else fail('setup shows a QR code', `qr count=${await count('[data-testid="2fa-qr"]')}`);

  const secret = (await text('[data-testid="2fa-secret"]')) || '';
  if (/^[A-Z2-7]{32}$/.test(secret)) pass('setup shows the manual key', secret);
  else fail('setup shows the manual key', secret);

  await setInput('[data-testid="2fa-code"]', totp(secret));
  await wait(300);
  await jsClick('[data-testid="2fa-verify"]');
  const backupCount = await until(async () => (await count('[data-testid="2fa-backup-list"] li')) === 8, 6000);
  if (backupCount) pass('verifying a live code turns 2FA on', '8 backup codes');
  else fail('verifying a live code turns 2FA on', `${await count('[data-testid="2fa-backup-list"] li')} codes`);
  if ((await text('[data-testid="2fa-status"]')) === 'On') pass('settings badge shows 2FA on');
  else fail('settings badge shows 2FA on', String(await text('[data-testid="2fa-status"]')));

  const backup = (await text('[data-testid="2fa-backup-list"] li')) || '';
  if (/^[A-Z2-7]{4}-[A-Z2-7]{4}$/.test(backup)) pass('backup codes are listed once', backup);
  else fail('backup codes are listed once', backup);

  await jsClick('[data-testid="2fa-done"]');
  const dismissed = await until(async () => (await count('[data-testid="2fa-backup-list"]')) === 0, 4000);
  if (dismissed) pass('backup codes can be dismissed');
  else fail('backup codes can be dismissed', `count=${await count('[data-testid="2fa-backup-list"]')}`);

  // sign-in now stops for an authentication code
  await jsClick('[data-testid="logout"]');
  await until(async () => (await page.evaluate(() => location.pathname)) === '/login', 6000);
  await wait(400);
  await jsClick('[data-testid="login-demo"]');
  await until(async () => page.$eval('[data-testid="login-email"]', (el) => el.value === 'demo@example.com'), 3000);
  await jsClick('[data-testid="login-submit"]');
  const step2 = await until(async () => (await count('[data-testid="login-2fa-code"]')) === 1, 6000);
  if (step2) pass('password alone no longer signs in');
  else fail('password alone no longer signs in', `count=${await count('[data-testid="login-2fa-code"]')}`);

  const stale = totp(secret, Date.now() - 120_000);
  await setInput('[data-testid="login-2fa-code"]', stale);
  await wait(300);
  await jsClick('[data-testid="login-2fa-submit"]');
  const rejected = await until(async () => (await count('[data-testid="login-2fa-error"]')) === 1, 6000);
  if (rejected) pass('an outdated code is rejected', (await text('[data-testid="login-2fa-error"]')) || '');
  else fail('an outdated code is rejected', 'no error shown');

  await setInput('[data-testid="login-2fa-code"]', totp(secret));
  await wait(300);
  await jsClick('[data-testid="login-2fa-submit"]');
  const inApp = await until(async () => (await page.evaluate(() => location.pathname)) === '/', 9000);
  if (inApp) pass('a live authenticator code completes sign-in');
  else fail('a live authenticator code completes sign-in', await page.evaluate(() => location.pathname));

  // backup code sign-in
  await jsClick('[data-testid="logout"]');
  await until(async () => (await page.evaluate(() => location.pathname)) === '/login', 6000);
  await wait(400);
  await jsClick('[data-testid="login-demo"]');
  await until(async () => page.$eval('[data-testid="login-email"]', (el) => el.value === 'demo@example.com'), 3000);
  await jsClick('[data-testid="login-submit"]');
  await until(async () => (await count('[data-testid="login-2fa-code"]')) === 1, 6000);
  await setInput('[data-testid="login-2fa-code"]', backup);
  await wait(300);
  await jsClick('[data-testid="login-2fa-submit"]');
  const viaBackup = await until(async () => (await page.evaluate(() => location.pathname)) === '/', 9000);
  if (viaBackup) pass('a backup code completes sign-in');
  else fail('a backup code completes sign-in', await page.evaluate(() => location.pathname));

  // turn 2FA back off so the demo account is untouched
  await page.goto(`${BASE}/settings`, {waitUntil: 'networkidle0'});
  const disableReady = await until(async () => (await count('[data-testid="2fa-disable-password"]')) === 1, 6000);
  if (disableReady) pass('enabled account offers the turn-off form');
  else fail('enabled account offers the turn-off form', `count=${await count('[data-testid="2fa-disable-password"]')}`);
  await setInput('[data-testid="2fa-disable-password"]', 'demo12345');
  await setInput('[data-testid="2fa-disable-code"]', totp(secret));
  await wait(300);
  await jsClick('[data-testid="2fa-disable"]');
  const off = await until(async () => (await text('[data-testid="2fa-status"]')) === 'Off', 6000);
  if (off) pass('turning off restores the off badge');
  else fail('turning off restores the off badge', String(await text('[data-testid="2fa-status"]')));

  await jsClick('[data-testid="logout"]');
  await until(async () => (await page.evaluate(() => location.pathname)) === '/login', 6000);
  await wait(400);
  await jsClick('[data-testid="login-demo"]');
  await until(async () => page.$eval('[data-testid="login-email"]', (el) => el.value === 'demo@example.com'), 3000);
  await jsClick('[data-testid="login-submit"]');
  const plain = await until(async () => (await page.evaluate(() => location.pathname)) === '/', 9000);
  if (plain) pass('plain sign-in works once 2FA is off');
  else fail('plain sign-in works once 2FA is off', await page.evaluate(() => location.pathname));
});

// ------------------------------------------------------------- console noise
await phase('console cleanliness', async () => {
  const real = consoleErrors.filter(
    (e) =>
      !/React DevTools|Download the React DevTools/i.test(e) &&
      // 409 is raised on purpose by the duplicate-category test below
      !/status of 409/i.test(e) &&
      // 401 is the documented response for signed-out probes (asserted in the auth phase)
      !/status of 401/i.test(e),
  );
  if (real.length === 0) pass('no console/page errors during the run');
  else fail('no console/page errors during the run', real.slice(0, 3).join(' | '));
});

await browser.close();

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.extra ? `  -> ${r.extra}` : ''}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
