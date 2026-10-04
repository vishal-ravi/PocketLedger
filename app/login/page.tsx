'use client';
import {useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {IndianRupee, LogIn} from 'lucide-react';

const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'demo12345';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [twoCode, setTwoCode] = useState('');
  const [twoError, setTwoError] = useState('');
  const [twoBusy, setTwoBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({email, password}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not sign in');
        return;
      }
      if (data.requires2FA && data.challenge) {
        setChallenge(data.challenge);
        setTwoCode('');
        setTwoError('');
        return;
      }
      const next = new URLSearchParams(window.location.search).get('next') || '/';
      router.replace(next);
      router.refresh();
    } catch {
      setError('Could not reach the server');
    } finally {
      setBusy(false);
    }
  }

  async function submitTwo(event: React.FormEvent) {
    event.preventDefault();
    if (!challenge) return;
    setTwoBusy(true);
    setTwoError('');
    try {
      const res = await fetch('/api/auth/login/2fa', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({challenge, code: twoCode}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTwoError(data.error || 'Could not sign in');
        return;
      }
      const next = new URLSearchParams(window.location.search).get('next') || '/';
      router.replace(next);
      router.refresh();
    } catch {
      setTwoError('Could not reach the server');
    } finally {
      setTwoBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-4 max-w-md sm:mt-10">
      <div className="card p-6 anim sm:p-8">
        <div className="flex items-center gap-3">
          <span className="icon-tile">
            <IndianRupee size={20} strokeWidth={2.6} className="text-emerald-700" />
          </span>
          <div className="leading-tight">
            <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">Welcome back</h1>
            <p className="text-[13px] text-slate-500">Sign in to PocketLedger</p>
          </div>
        </div>

        {!challenge ? (
        <form onSubmit={submit} className="mt-6 grid gap-4">
          <div>
            <label className="label" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              className="input"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="login-email"
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              className="input"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="login-password"
              required
            />
          </div>
          <p className="-mt-2 text-right text-[13px]">
            <Link href="/forgot-password" className="font-semibold text-emerald-600 link-underline" data-testid="go-forgot">
              Forgot password?
            </Link>
          </p>

          {error && (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-600" data-testid="login-error">
              {error}
            </p>
          )}

          <button className="btn btn-primary w-full" type="submit" disabled={busy} data-testid="login-submit">
            <LogIn size={16} strokeWidth={3} />
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <button
            type="button"
            className="btn btn-ghost w-full"
            onClick={() => {
              setEmail(DEMO_EMAIL);
              setPassword(DEMO_PASSWORD);
              setError('');
            }}
            data-testid="login-demo"
          >
            Use the demo account
          </button>
        </form>
        ) : (
        <form onSubmit={submitTwo} className="mt-6 grid gap-4">
          <div>
            <label className="label" htmlFor="login-2fa-code">
              Authentication code
            </label>
            <input
              id="login-2fa-code"
              className="input text-center text-lg tracking-[0.3em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              maxLength={10}
              value={twoCode}
              onChange={(e) => setTwoCode(e.target.value)}
              data-testid="login-2fa-code"
              required
              autoFocus
            />
            <p className="mt-2 text-[12.5px] text-slate-500">
              Open your authenticator app and enter the 6-digit code for PocketLedger.
            </p>
          </div>

          {twoError && (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-600" data-testid="login-2fa-error">
              {twoError}
            </p>
          )}

          <button className="btn btn-primary w-full" type="submit" disabled={twoBusy} data-testid="login-2fa-submit">
            <LogIn size={16} strokeWidth={3} />
            {twoBusy ? 'Verifying…' : 'Verify and sign in'}
          </button>

          <button
            type="button"
            className="btn btn-ghost w-full"
            onClick={() => {
              setChallenge(null);
              setTwoCode('');
              setTwoError('');
            }}
            data-testid="login-2fa-back"
          >
            Back to password
          </button>
        </form>
        )}

        <p className="mt-5 text-center text-[13.5px] text-slate-500">
          New to PocketLedger?{' '}
          <Link href="/signup" className="font-bold text-emerald-600 link-underline" data-testid="go-signup">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
