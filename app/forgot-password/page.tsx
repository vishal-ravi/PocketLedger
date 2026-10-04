'use client';
import {useState} from 'react';
import Link from 'next/link';
import {KeyRound, Mail} from 'lucide-react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({email}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not send the reset email');
        return;
      }
      setSent(true);
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
            <h1 className="text-[22px] font-extrabold tracking-tight text-slate-900">Forgot password?</h1>
            <p className="text-[13px] text-slate-500">We&apos;ll email you a reset link</p>
          </div>
        </div>

        {sent ? (
          <div className="mt-6 rounded-2xl bg-emerald-50 p-4 text-[14px] text-emerald-800" data-testid="forgot-sent">
            <p className="font-bold">Check your inbox</p>
            <p className="mt-1 text-[13px] text-emerald-700">
              If an account exists for <span className="font-semibold">{email}</span>, a reset link is on its way. The
              link expires in 60 minutes.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 grid gap-4">
            <div>
              <label className="label" htmlFor="forgot-email">
                Email
              </label>
              <input
                id="forgot-email"
                className="input"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="forgot-email"
                required
              />
            </div>

            {error && (
              <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-600" data-testid="forgot-error">
                {error}
              </p>
            )}

            <button className="btn btn-primary w-full" type="submit" disabled={busy} data-testid="forgot-submit">
              <Mail size={16} strokeWidth={3} />
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        <p className="mt-5 text-center text-[13.5px] text-slate-500">
          Remembered it?{' '}
          <Link href="/login" className="font-bold text-emerald-600 link-underline" data-testid="back-login">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
