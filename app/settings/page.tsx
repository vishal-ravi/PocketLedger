'use client';
import {useCallback, useEffect, useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {Header} from '@/components/header';
import {loadUser, useUser} from '@/lib/use-user';
import {Check, Monitor, Moon, Settings, ShieldCheck, Sun, UserRound} from 'lucide-react';

type Theme = 'light' | 'dark' | 'system';

function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

function AppearanceCard() {
  const [theme, setTheme] = useState<Theme>('system');

  useState(() => {
    if (typeof window === 'undefined') return;
    const saved = (localStorage.getItem('theme') as Theme | null) ?? 'system';
    setTheme(saved);
  });

  function choose(next: Theme) {
    setTheme(next);
    if (next === 'system') localStorage.removeItem('theme');
    else localStorage.setItem('theme', next);
    applyTheme(next);
  }

  const options: {value: Theme; label: string; Icon: typeof Sun}[] = [
    {value: 'light', label: 'Light', Icon: Sun},
    {value: 'dark', label: 'Dark', Icon: Moon},
    {value: 'system', label: 'System', Icon: Monitor},
  ];

  return (
    <div className="card p-6 anim lg:col-span-3" style={{['--d' as string]: '110ms'}}>
      <h2 className="font-bold text-slate-900">Appearance</h2>
      <p className="text-xs text-slate-500">Stored in this browser; applies to every page instantly.</p>
      <div className="mt-4 flex flex-wrap gap-2.5" data-testid="theme-picker">
        {options.map(({value, label, Icon}) => (
          <button
            key={value}
            type="button"
            className="chip"
            data-active={theme === value}
            data-testid={`theme-${value}`}
            onClick={() => choose(value)}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>
    </div>
  );
}

type Profile = {id: string; fullName: string; currencySymbol: string; monthlyIncome: number};

function ProfileForm({profile}: {profile: Profile}) {
  const [form, setForm] = useState(() => ({
    fullName: profile.fullName,
    currencySymbol: profile.currencySymbol,
    monthlyIncome: String(profile.monthlyIncome),
  }));
  const [status, setStatus] = useState<{kind: 'ok' | 'error'; message: string} | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch('/api/user', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({...form, monthlyIncome: Number(form.monthlyIncome || 0)}),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus({kind: 'error', message: data.error || 'Could not save settings'});
        return;
      }
      await loadUser();
      setStatus({kind: 'ok', message: 'Settings saved. Everything is up to date.'});
    } catch {
      setStatus({kind: 'error', message: 'Could not save settings'});
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="card p-6 anim lg:col-span-2" style={{['--d' as string]: '90ms'}}>
      <h2 className="font-bold text-slate-900">Profile</h2>
      <p className="text-xs text-slate-500">Used across your dashboard, exports and formatting.</p>

      {status && (
        <div
          className={`anim-fade mt-4 flex items-center gap-2 rounded-xl p-3 text-sm font-semibold ${
            status.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
          }`}
        >
          {status.kind === 'ok' && <Check size={16} strokeWidth={3} />}
          {status.message}
        </div>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="s-name">Full name</label>
          <input
            id="s-name"
            required
            className="input"
            value={form.fullName}
            onChange={(e) => setForm({...form, fullName: e.target.value})}
          />
        </div>
        <div>
          <label className="label" htmlFor="s-cur">Currency symbol</label>
          <input
            id="s-cur"
            required
            className="input"
            maxLength={5}
            value={form.currencySymbol}
            onChange={(e) => setForm({...form, currencySymbol: e.target.value})}
          />
        </div>
        <div>
          <label className="label" htmlFor="s-income">Monthly income</label>
          <input
            id="s-income"
            className="input"
            type="number"
            min="0"
            step="0.01"
            value={form.monthlyIncome}
            onChange={(e) => setForm({...form, monthlyIncome: e.target.value})}
          />
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <button className="btn btn-primary" disabled={busy}>
          <Check size={16} strokeWidth={3} />
          {busy ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  );
}

function SecurityCard() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [twoFa, setTwoFa] = useState<{enabled: boolean; pending: boolean} | null>(null);
  const [setup, setSetup] = useState<{secret: string; uri: string; qr: string} | null>(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [twoBusy, setTwoBusy] = useState(false);
  const [twoStatus, setTwoStatus] = useState<{kind: 'ok' | 'error'; message: string} | null>(null);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');

  useEffect(() => {
    fetch('/api/2fa')
      .then((r) => r.json())
      .then((data) => setTwoFa({enabled: !!data.enabled, pending: !!data.pending}))
      .catch(() => setTwoFa({enabled: false, pending: false}));
  }, []);

  async function logoutEverywhere() {
    setBusy(true);
    setStatus('');
    try {
      const res = await fetch('/api/auth/logout-all', {method: 'POST'});
      if (!res.ok) {
        setStatus('Could not sign out of all devices');
        return;
      }
      router.replace('/login');
      router.refresh();
    } catch {
      setStatus('Could not reach the server');
      setBusy(false);
    }
  }

  async function startSetup() {
    setTwoBusy(true);
    setTwoStatus(null);
    try {
      const res = await fetch('/api/2fa/setup', {method: 'POST'});
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTwoStatus({kind: 'error', message: data.error || 'Could not start setup'});
        return;
      }
      setSetup({secret: data.secret, uri: data.uri, qr: data.qr});
      setCode('');
    } catch {
      setTwoStatus({kind: 'error', message: 'Could not reach the server'});
    } finally {
      setTwoBusy(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    setTwoBusy(true);
    setTwoStatus(null);
    try {
      const res = await fetch('/api/2fa/verify', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({code}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTwoStatus({kind: 'error', message: data.error || 'Invalid authentication code'});
        return;
      }
      setSetup(null);
      setCode('');
      setTwoFa({enabled: true, pending: false});
      setBackupCodes(data.backupCodes || []);
      setTwoStatus({kind: 'ok', message: 'Two-factor authentication is on.'});
    } catch {
      setTwoStatus({kind: 'error', message: 'Could not reach the server'});
    } finally {
      setTwoBusy(false);
    }
  }

  async function disableTwoFa(event: React.FormEvent) {
    event.preventDefault();
    setTwoBusy(true);
    setTwoStatus(null);
    try {
      const res = await fetch('/api/2fa/disable', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({password: disablePassword, code: disableCode}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTwoStatus({kind: 'error', message: data.error || 'Could not turn off two-factor'});
        return;
      }
      setTwoFa({enabled: false, pending: false});
      setDisablePassword('');
      setDisableCode('');
      setTwoStatus({kind: 'ok', message: 'Two-factor authentication is off.'});
    } catch {
      setTwoStatus({kind: 'error', message: 'Could not reach the server'});
    } finally {
      setTwoBusy(false);
    }
  }

  return (
    <div className="card p-6 anim lg:col-span-3" style={{['--d' as string]: '130ms'}}>
      <h2 className="font-bold text-slate-900">Security</h2>
      <p className="text-xs text-slate-500">
        Sessions last 30 days. Changing your password or signing out everywhere immediately invalidates every other
        device.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-soft" onClick={logoutEverywhere} disabled={busy} data-testid="logout-all">
          {busy ? 'Signing out…' : 'Log out of all devices'}
        </button>
        <Link href="/forgot-password" className="text-[13.5px] font-bold text-emerald-600 link-underline" data-testid="settings-forgot">
          Change password via email
        </Link>
        {status && <span className="text-[13px] font-semibold text-rose-600">{status}</span>}
      </div>

      <div className="mt-6 border-t border-slate-100 pt-5" data-testid="2fa-section">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <ShieldCheck size={15} /> Two-factor authentication
            </p>
            <p className="text-xs text-slate-500">Ask for a 6-digit authenticator code after your password at sign-in.</p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-extrabold ${
              twoFa?.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
            }`}
            data-testid="2fa-status"
          >
            {twoFa === null ? '…' : twoFa.enabled ? 'On' : 'Off'}
          </span>
        </div>

        {backupCodes ? (
          <div className="anim-fade mt-4 rounded-2xl bg-emerald-50 p-4" data-testid="2fa-backup-wrap">
            <p className="text-[13px] font-bold text-emerald-800">
              Save these backup codes somewhere safe — each one works once if you lose your authenticator.
            </p>
            <ul className="mt-3 grid gap-1.5 sm:grid-cols-2" data-testid="2fa-backup-list">
              {backupCodes.map((backup) => (
                <li key={backup} className="rounded-lg bg-white px-2 py-1 font-mono text-[13px] font-bold text-slate-800" data-testid="2fa-backup-code">
                  {backup}
                </li>
              ))}
            </ul>
            <button type="button" className="btn btn-primary mt-4" onClick={() => setBackupCodes(null)} data-testid="2fa-done">
              I saved them
            </button>
          </div>
        ) : twoFa?.enabled ? (
          <form onSubmit={disableTwoFa} className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="2fa-disable-password">
                Password
              </label>
              <input
                id="2fa-disable-password"
                className="input"
                type="password"
                autoComplete="current-password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                data-testid="2fa-disable-password"
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="2fa-disable-code">
                Authenticator or backup code
              </label>
              <input
                id="2fa-disable-code"
                className="input"
                inputMode="numeric"
                maxLength={10}
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value)}
                data-testid="2fa-disable-code"
                required
              />
            </div>
            <div className="flex justify-end sm:col-span-2">
              <button className="btn btn-soft" disabled={twoBusy} data-testid="2fa-disable">
                {twoBusy ? 'Turning off…' : 'Turn off two-factor'}
              </button>
            </div>
          </form>
        ) : setup ? (
          <div className="anim-fade mt-4 rounded-2xl bg-slate-50 p-4">
            <div className="flex flex-wrap items-start gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- QR is a base64 data URL from the API */}
              <img src={setup.qr} alt="Authenticator QR code" width={120} height={120} className="rounded-xl bg-white p-1" data-testid="2fa-qr" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-500">Scan the QR code with Google Authenticator, Authy or 1Password — or enter this key manually:</p>
                <p className="mt-1 break-all rounded-lg bg-white px-2 py-1 font-mono text-[13px] font-bold text-slate-800" data-testid="2fa-secret">
                  {setup.secret}
                </p>
                <form onSubmit={verifyCode} className="mt-3 flex flex-wrap items-end gap-2">
                  <div>
                    <label className="label" htmlFor="2fa-code">
                      6-digit code
                    </label>
                    <input
                      id="2fa-code"
                      className="input w-40"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={10}
                      placeholder="123456"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      data-testid="2fa-code"
                      required
                    />
                  </div>
                  <button className="btn btn-primary" disabled={twoBusy} data-testid="2fa-verify">
                    {twoBusy ? 'Checking…' : 'Turn on'}
                  </button>
                </form>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-soft" onClick={startSetup} disabled={twoBusy || twoFa === null} data-testid="2fa-setup">
              <ShieldCheck size={16} />
              Set up two-factor
            </button>
          </div>
        )}

        {twoStatus && (
          <p
            className={`mt-3 text-[13px] font-semibold ${twoStatus.kind === 'ok' ? 'text-emerald-600' : 'text-rose-600'}`}
            data-testid="2fa-message"
          >
            {twoStatus.message}
          </p>
        )}
      </div>
    </div>
  );
}


type HouseholdMember = {userId: string; fullName: string; email: string; role: 'OWNER' | 'MEMBER'};
type Household = {id: string; name: string; inviteCode: string; role: 'OWNER' | 'MEMBER'; members: HouseholdMember[]};

function HouseholdCard() {
  const [household, setHousehold] = useState<Household | null>(null);
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [message, setMessage] = useState<{kind: 'ok' | 'error'; text: string} | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch('/api/household')
      .then((res) => res.json())
      .then((data) => {
        if (data.household) {
          setHousehold(data.household);
          setName(data.household.name);
        } else {
          setMessage({kind: 'error', text: data.error || 'Could not load your household'});
        }
      })
      .catch(() => setMessage({kind: 'error', text: 'Could not reach the server'}));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function post(path: string, body?: unknown): Promise<{ok: boolean; data: {error?: string; inviteCode?: string; name?: string}}> {
    const res = await fetch(path, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    const data = await res.json().catch(() => ({}));
    return {ok: res.ok, data};
  }

  async function rename(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/household', {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setMessage({kind: 'error', text: data.error || 'Could not save the name'});
      else {
        setHousehold(data.household);
        setMessage({kind: 'ok', text: 'Household name updated.'});
      }
    } catch {
      setMessage({kind: 'error', text: 'Could not reach the server'});
    } finally {
      setBusy(false);
    }
  }

  async function join(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = await post('/api/household/join', {code: joinCode});
      if (!result.ok) setMessage({kind: 'error', text: result.data.error || 'Could not join that household'});
      else {
        setJoinCode('');
        setMessage({kind: 'ok', text: `Joined ${result.data.name ?? 'the household'}.`});
        load();
      }
    } catch {
      setMessage({kind: 'error', text: 'Could not reach the server'});
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await post('/api/household/leave');
      if (!result.ok) setMessage({kind: 'error', text: result.data.error || 'Could not leave the household'});
      else {
        setMessage({kind: 'ok', text: 'You left the household.'});
        load();
      }
    } catch {
      setMessage({kind: 'error', text: 'Could not reach the server'});
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await post('/api/household/regenerate');
      if (!result.ok) setMessage({kind: 'error', text: result.data.error || 'Could not regenerate the code'});
      else if (household && result.data.inviteCode) {
        setHousehold({...household, inviteCode: result.data.inviteCode});
        setMessage({kind: 'ok', text: 'New invite code generated.'});
      }
    } catch {
      setMessage({kind: 'error', text: 'Could not reach the server'});
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-6 anim lg:col-span-3" style={{['--d' as string]: '145ms'}} data-testid="hh-section">
      <h2 className="font-bold text-slate-900">Household</h2>
      <p className="text-xs text-slate-500">
        Share one ledger with your family — everyone in the household sees the same expenses, budgets, cards and goals.
      </p>

      {message && (
        <p
          className={`mt-3 text-[13px] font-semibold ${message.kind === 'ok' ? 'text-emerald-600' : 'text-rose-600'}`}
          data-testid="hh-message"
        >
          {message.text}
        </p>
      )}

      {household ? (
        <>
          <form onSubmit={rename} className="mt-4 flex flex-wrap items-end gap-3">
            <div className="min-w-52">
              <label className="label" htmlFor="hh-name">
                Household name
              </label>
              <input
                id="hh-name"
                className="input"
                maxLength={60}
                value={name}
                onChange={(event) => setName(event.target.value)}
                data-testid="hh-name"
                required
              />
            </div>
            <button className="btn btn-soft" disabled={busy} data-testid="hh-rename">
              Save name
            </button>
          </form>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400" data-testid="hh-member-count">
                Members · {household.members.length}
              </p>
              <ul className="mt-2 grid gap-1.5" data-testid="hh-members">
                {household.members.map((member) => (
                  <li
                    key={member.userId}
                    className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm"
                    data-testid="hh-member"
                  >
                    <span className="min-w-0">
                      <b className="block truncate text-slate-800">{member.fullName}</b>
                      <span className="block truncate text-xs text-slate-500">{member.email}</span>
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-extrabold ${
                        member.role === 'OWNER' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {member.role === 'OWNER' ? 'Owner' : 'Member'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Invite code</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className="rounded-xl bg-emerald-50 px-3 py-2 font-mono text-sm font-extrabold tracking-[0.2em] text-emerald-800"
                  data-testid="hh-invite"
                >
                  {household.inviteCode}
                </span>
                <button
                  type="button"
                  className="btn btn-soft"
                  onClick={regenerate}
                  disabled={busy || household.role !== 'OWNER'}
                  data-testid="hh-regen"
                >
                  Regenerate
                </button>
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                {household.role === 'OWNER'
                  ? 'Share this code so a family member can join.'
                  : 'Only the owner can regenerate the code.'}
              </p>

              <form onSubmit={join} className="mt-4 flex flex-wrap items-end gap-2">
                <div>
                  <label className="label" htmlFor="hh-join-code">
                    Join another household
                  </label>
                  <input
                    id="hh-join-code"
                    className="input w-44 uppercase"
                    placeholder="ABCD2345"
                    maxLength={32}
                    value={joinCode}
                    onChange={(event) => setJoinCode(event.target.value)}
                    data-testid="hh-join-code"
                    required
                  />
                </div>
                <button className="btn btn-primary" disabled={busy} data-testid="hh-join">
                  Join
                </button>
              </form>

              <button
                type="button"
                className="btn btn-ghost mt-4 text-rose-600"
                onClick={leave}
                disabled={busy}
                data-testid="hh-leave"
              >
                Leave household
              </button>
            </div>
          </div>
        </>
      ) : (
        !message && (
          <p className="mt-4 text-sm text-slate-500" data-testid="hh-loading">
            Loading your household…
          </p>
        )
      )}
    </div>
  );
}

export default function SettingsPage() {
  const user = useUser();

  return (
    <>
      <Header title="Settings" subtitle="Personalize your finance tracker." />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="hero p-6 anim lg:col-span-1">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/15">
            <UserRound size={22} />
          </span>
          <div className="mt-4 text-xl font-extrabold text-white">{user?.fullName ?? '…'}</div>
          <div className="text-sm text-emerald-100/70">{user?.email ?? ''}</div>
          <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-emerald-50">
            <Settings size={13} /> Preferences apply everywhere
          </div>
        </div>

        {user ? (
          <ProfileForm
            key={user.id}
            profile={{
              id: user.id,
              fullName: user.fullName,
              currencySymbol: user.currencySymbol,
              monthlyIncome: user.monthlyIncome,
            }}
          />
        ) : (
          <div className="card flex items-center justify-center gap-3 p-6 text-sm text-slate-500 lg:col-span-2">
            Loading your profile…
          </div>
        )}

        <SecurityCard />
        <HouseholdCard />
        <AppearanceCard />
      </div>
    </>
  );
}
