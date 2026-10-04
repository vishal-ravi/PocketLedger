'use client';
import {useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {IndianRupee, UserPlus} from 'lucide-react';

export default function SignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({email, fullName, password}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not create the account');
        return;
      }
      router.replace('/');
      router.refresh();
    } catch {
      setError('Could not reach the server');
    } finally {
      setBusy(false);
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
            <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">Create your account</h1>
            <p className="text-[13px] text-slate-500">Your own ledger, private to you</p>
          </div>
        </div>

        <form onSubmit={submit} className="mt-6 grid gap-4">
          <div>
            <label className="label" htmlFor="signup-name">
              Full name
            </label>
            <input
              id="signup-name"
              className="input"
              type="text"
              autoComplete="name"
              placeholder="Anita Sharma"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              data-testid="signup-name"
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="signup-email">
              Email
            </label>
            <input
              id="signup-email"
              className="input"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="signup-email"
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="signup-password">
              Password
            </label>
            <input
              id="signup-password"
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="signup-password"
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="signup-confirm">
              Confirm password
            </label>
            <input
              id="signup-confirm"
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder="Repeat your password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              data-testid="signup-confirm"
              required
            />
          </div>

          {error && (
            <p
              className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-600"
              data-testid="signup-error"
            >
              {error}
            </p>
          )}

          <button className="btn btn-primary w-full" type="submit" disabled={busy} data-testid="signup-submit">
            <UserPlus size={16} strokeWidth={3} />
            {busy ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="mt-5 text-center text-[13.5px] text-slate-500">
          Already have an account?{' '}
          <Link href="/login" className="font-bold text-emerald-600 link-underline" data-testid="go-login">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
