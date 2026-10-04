'use client';
import {Suspense, useState} from 'react';
import Link from 'next/link';
import {useRouter, useSearchParams} from 'next/navigation';
import {KeyRound} from 'lucide-react';

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
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
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({token, password}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not reset the password');
        return;
      }
      router.replace('/login?reset=1');
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
            <KeyRound size={20} strokeWidth={2.6} className="text-emerald-700" />
          </span>
          <div className="leading-tight">
            <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">Choose a new password</h1>
            <p className="text-[13px] text-slate-500">All existing sessions will be signed out</p>
          </div>
        </div>

        {!token ? (
          <div className="mt-6 rounded-xl bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-600" data-testid="reset-error">
            This reset link is missing or invalid.{' '}
            <Link href="/forgot-password" className="underline">
              Request a new one
            </Link>
            .
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 grid gap-4">
            <div>
              <label className="label" htmlFor="reset-password">
                New password
              </label>
              <input
                id="reset-password"
                className="input"
                type="password"
                autoComplete="new-password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-testid="reset-password"
                minLength={8}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="reset-confirm">
                Confirm password
              </label>
              <input
                id="reset-confirm"
                className="input"
                type="password"
                autoComplete="new-password"
                placeholder="Repeat the password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                data-testid="reset-confirm"
                minLength={8}
                required
              />
            </div>

            {error && (
              <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-600" data-testid="reset-error">
                {error}
              </p>
            )}

            <button className="btn btn-primary w-full" type="submit" disabled={busy} data-testid="reset-submit">
              {busy ? 'Saving…' : 'Reset password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
