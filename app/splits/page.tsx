'use client';
import {useCallback, useEffect, useState} from 'react';
import {Header} from '@/components/header';
import {inr} from '@/lib/use-count-up';
import {useUser} from '@/lib/use-user';
import {ArrowDownLeft, ArrowUpRight, CheckCircle2, History, Users} from 'lucide-react';

type Person = {name: string; owed: number; owe: number; balance: number};
type HistoryRow = {
  id: string;
  personName: string;
  direction: 'I_OWE' | 'OWED_TO_ME';
  amount: number;
  date: string;
  note: string | null;
  expenseId: string | null;
};
type SplitsState = {receivable: number; payable: number; people: Person[]; history: HistoryRow[]};

const today = () => new Date().toISOString().slice(0, 10);

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', {day: 'numeric', month: 'short', year: 'numeric'});

export default function Splits() {
  const [data, setData] = useState<SplitsState>({receivable: 0, payable: 0, people: [], history: []});
  const [target, setTarget] = useState<string | null>(null);
  const [form, setForm] = useState({amount: '', date: today(), note: ''});
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState(false);
  const user = useUser();
  const symbol = user?.currencySymbol ?? '₹';

  const load = useCallback(() => {
    fetch('/api/repayments')
      .then((r) => r.json())
      .then((d) =>
        setData({
          receivable: Number(d.receivable) || 0,
          payable: Number(d.payable) || 0,
          people: d.people || [],
          history: d.history || [],
        }),
      )
      .catch(() => setData({receivable: 0, payable: 0, people: [], history: []}));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function startRepay(person: Person) {
    setTarget(person.name);
    setForm({amount: String(Math.abs(person.balance)), date: today(), note: ''});
    setError('');
    setFlash('');
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!target) return;
    const person = data.people.find((row) => row.name === target);
    if (!person) return;
    const direction = person.balance < 0 ? 'I_OWE' : 'OWED_TO_ME';
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/repayments', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          personName: target,
          direction,
          amount: Number(form.amount),
          date: form.date,
          note: form.note.trim() || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || 'Could not record the repayment');
        return;
      }
      setFlash(
        direction === 'I_OWE'
          ? `Repaid ${inr(Number(form.amount), symbol)} to ${target} · logged as a NEED expense`
          : `Recorded ${inr(Number(form.amount), symbol)} received from ${target}`,
      );
      setTarget(null);
      load();
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Header title="Split & Debts" subtitle="Settle what you owe and record what others owe you." />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="hero p-6 anim">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-100/70">Owed to me</span>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/15">
              <ArrowDownLeft size={17} />
            </span>
          </div>
          <div className="mt-3 text-3xl font-extrabold tracking-tight text-white">{inr(data.receivable, symbol)}</div>
          <div className="mt-1.5 text-xs text-emerald-100/70">Collectable from friends &amp; family</div>
        </div>

        <div className="hero p-6 anim" style={{['--d' as string]: '90ms', ['--hero' as string]: 'linear-gradient(135deg,#2e1065,#5b21b6,#7c3aed)'}}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-violet-100/70">I owe</span>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/15">
              <ArrowUpRight size={17} />
            </span>
          </div>
          <div className="mt-3 text-3xl font-extrabold tracking-tight text-white">{inr(data.payable, symbol)}</div>
          <div className="mt-1.5 text-xs text-violet-100/70">Repay these to stay even</div>
        </div>
      </div>

      {flash && (
        <div
          className="mt-5 flex items-center gap-2 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-[13px] font-semibold text-emerald-800 anim-fade"
          data-testid="repay-flash"
        >
          <CheckCircle2 size={16} /> {flash}
        </div>
      )}

      <div className="card mt-5 overflow-hidden anim" style={{['--d' as string]: '150ms'}} data-testid="people-balances">
        <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-5">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-emerald-100 text-emerald-700">
            <Users size={18} />
          </span>
          <div>
            <h2 className="font-bold text-slate-900">Person-wise balances</h2>
            <p className="text-xs text-slate-500">Everyone with an open balance — settle it here</p>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {data.people.map((p, index) => (
            <div
              key={p.name}
              className="anim flex flex-wrap items-center justify-between gap-3 px-6 py-4 transition hover:bg-emerald-50/50"
              style={{['--d' as string]: `${index * 50}ms`}}
            >
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-sm font-bold text-white">
                  {initials(p.name) || '?'}
                </span>
                <div>
                  <span className="font-semibold text-slate-800">{p.name}</span>
                  <div className="text-[11.5px] text-slate-500">
                    {p.owed > 0 ? `owes you ${inr(p.owed, symbol)}` : ''}{' '}
                    {p.owe > 0 ? `you owe ${inr(p.owe, symbol)}` : ''}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`badge ${p.balance >= 0 ? 'badge-need' : 'badge-want'}`}>
                  {p.balance >= 0 ? 'Owes you' : 'You owe'} {inr(Math.abs(p.balance), symbol)}
                </span>
                <button
                  type="button"
                  className="btn btn-soft"
                  onClick={() => startRepay(p)}
                  data-testid="repay-open"
                >
                  {p.balance < 0 ? 'Repay' : 'Mark received'}
                </button>
              </div>
            </div>
          ))}
        </div>

        {!data.people.length && (
          <div className="p-12 text-center">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600">
              <Users size={22} />
            </div>
            <p className="font-semibold text-slate-700">No open split balances</p>
            <p className="mt-1 text-sm text-slate-500">Log a split expense to see who owes what.</p>
          </div>
        )}
      </div>

      {target && (
        <form onSubmit={submit} className="card mt-5 p-5 anim-fade" data-testid="repay-form">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-slate-900">
                {(() => {
                  const person = data.people.find((row) => row.name === target);
                  return person && person.balance < 0 ? `Repay ${target}` : `Record payment from ${target}`;
                })()}
              </h2>
              <p className="text-xs text-slate-500">
                {(() => {
                  const person = data.people.find((row) => row.name === target);
                  return person && person.balance < 0
                    ? 'Creates a NEED expense so the cash-out shows in your budgets.'
                    : 'Collections are not income, so no ledger entry is created.';
                })()}
              </p>
            </div>
            <button type="button" className="btn btn-ghost" onClick={() => setTarget(null)}>
              Cancel
            </button>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-3">
            <label className="label">
              Amount
              <input
                className="input"
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => setForm({...form, amount: e.target.value})}
                data-testid="repay-amount"
              />
            </label>
            <label className="label">
              Date
              <input
                className="input"
                type="date"
                value={form.date}
                onChange={(e) => setForm({...form, date: e.target.value})}
                data-testid="repay-date"
              />
            </label>
            <label className="label">
              Note
              <input
                className="input"
                placeholder="optional"
                value={form.note}
                onChange={(e) => setForm({...form, note: e.target.value})}
                data-testid="repay-note"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button className="btn btn-primary" type="submit" disabled={busy} data-testid="repay-save">
              {busy ? 'Saving…' : 'Record repayment'}
            </button>
            {error && (
              <span className="text-[12.5px] font-semibold text-rose-600" data-testid="repay-error">
                {error}
              </span>
            )}
          </div>
        </form>
      )}

      <div className="card mt-5 overflow-hidden anim" style={{['--d' as string]: '220ms'}} data-testid="repay-history">
        <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-5">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-violet-100 text-violet-700">
            <History size={18} />
          </span>
          <div>
            <h2 className="font-bold text-slate-900">Repayment history</h2>
            <p className="text-xs text-slate-500">Every settlement you have recorded</p>
          </div>
        </div>

        {data.history.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-400">No repayments recorded yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {data.history.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3.5">
                <div className="flex items-center gap-3">
                  <span
                    className={`grid h-8 w-8 place-items-center rounded-xl ${
                      row.direction === 'I_OWE' ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'
                    }`}
                  >
                    {row.direction === 'I_OWE' ? <ArrowUpRight size={15} /> : <ArrowDownLeft size={15} />}
                  </span>
                  <div>
                    <div className="text-[13.5px] font-bold text-slate-900">
                      {row.direction === 'I_OWE' ? `Paid ${row.personName}` : `${row.personName} paid you`}
                    </div>
                    <div className="text-[11.5px] text-slate-500">
                      {fmtDay(row.date)}
                      {row.note ? ` · ${row.note}` : ''}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {row.expenseId && <span className="badge badge-need">expense logged</span>}
                  <span className="text-[14px] font-extrabold text-slate-900">{inr(row.amount, symbol)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
