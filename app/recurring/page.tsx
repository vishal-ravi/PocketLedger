'use client';
import {useCallback, useEffect, useState} from 'react';
import Link from 'next/link';
import {Header} from '@/components/header';
import {formatMoney, useUser} from '@/lib/use-user';
import {CalendarClock, Check, Pause, Play, Plus, Repeat, Trash2} from 'lucide-react';

type Category = {id: string; name: string};
type Card = {id: string; cardName: string};
type Rule = {
  id: string;
  description: string;
  amount: number;
  type: string;
  categoryId: string | null;
  categoryName: string | null;
  creditCardId: string | null;
  cardName: string | null;
  paymentMethod: string;
  interval: 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  startDate: string;
  nextDueDate: string;
  endDate: string | null;
  autoPost: boolean;
  paused: boolean;
  notes: string | null;
  daysToDue: number;
  overdue: boolean;
};

const emptyForm = {
  description: '',
  amount: '',
  type: 'NEED',
  categoryId: '',
  paymentMethod: 'UPI',
  creditCardId: '',
  interval: 'MONTHLY',
  startDate: new Date().toISOString().slice(0, 10),
  endDate: '',
  autoPost: true,
  notes: '',
};

const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', {day: 'numeric', month: 'short', year: 'numeric'});

export default function Recurring() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [form, setForm] = useState({...emptyForm});
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const user = useUser();
  const symbol = user?.currencySymbol ?? '₹';
  const money = (value: number) => formatMoney(value, symbol);

  const load = useCallback(() => {
    fetch('/api/recurring')
      .then((r) => r.json())
      .then((d) => setRules(d.rules || []))
      .catch(() => setRules([]));
  }, []);

  useEffect(() => {
    load();
    fetch('/api/categories')
      .then((r) => r.json())
      .then((d) => setCats(d.categories || []))
      .catch(() => setCats([]));
    fetch('/api/credit-cards')
      .then((r) => r.json())
      .then((d) => setCards(d.cards || []))
      .catch(() => setCards([]));
  }, [load]);

  const monthly = rules
    .filter((r) => !r.paused && r.type !== 'INCOME')
    .reduce((sum, r) => sum + (r.interval === 'WEEKLY' ? r.amount * 4.33 : r.interval === 'YEARLY' ? r.amount / 12 : r.amount), 0);

  function setMethod(value: string) {
    setForm((current) => {
      if (value !== 'CREDIT_CARD') return {...current, paymentMethod: value, creditCardId: ''};
      const picked = current.creditCardId || (cards.length === 1 ? cards[0].id : '');
      return {...current, paymentMethod: value, creditCardId: picked};
    });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/recurring', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          description: form.description.trim(),
          amount: Number(form.amount),
          type: form.type,
          categoryId: form.type === 'INCOME' ? null : form.categoryId || null,
          paymentMethod: form.paymentMethod,
          creditCardId: form.paymentMethod === 'CREDIT_CARD' && form.creditCardId ? form.creditCardId : null,
          interval: form.interval,
          startDate: form.startDate,
          endDate: form.endDate || null,
          autoPost: form.autoPost,
          notes: form.notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not save the rule');
        return;
      }
      setForm({...emptyForm, startDate: new Date().toISOString().slice(0, 10)});
      setOpen(false);
      load();
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
  }

  async function postNow(rule: Rule) {
    setBusy(true);
    const res = await fetch(`/api/recurring/${rule.id}/post`, {method: 'POST'}).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const data = await res?.json().catch(() => null);
      setError(data?.error || 'Could not record the payment');
      return;
    }
    setError('');
    load();
  }

  async function toggle(rule: Rule) {
    await fetch(`/api/recurring/${rule.id}`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({paused: !rule.paused}),
    }).catch(() => null);
    load();
  }

  async function remove(rule: Rule) {
    if (!window.confirm(`Delete the recurring rule "${rule.description}"?`)) return;
    await fetch(`/api/recurring/${rule.id}`, {method: 'DELETE'}).catch(() => null);
    load();
  }

  const countdown = (rule: Rule) => {
    if (rule.paused) return {label: 'Paused', tone: 'bg-slate-100 text-slate-500'};
    if (rule.daysToDue < 0) return {label: `${Math.abs(rule.daysToDue)}d overdue`, tone: 'bg-rose-50 text-rose-600'};
    if (rule.daysToDue === 0) return {label: 'Today', tone: 'bg-amber-50 text-amber-700'};
    if (rule.daysToDue <= 3) return {label: `in ${rule.daysToDue}d`, tone: 'bg-amber-50 text-amber-700'};
    return {label: `in ${rule.daysToDue}d`, tone: 'bg-slate-100 text-slate-600'};
  };

  return (
    <>
      <Header
        title="Recurring"
        subtitle="Subscriptions, bills and repeat payments — posted for you or due as a reminder."
        action={
          <button className="btn btn-primary" type="button" onClick={() => setOpen((value) => !value)} data-testid="recurring-toggle">
            <Plus size={16} /> {open ? 'Cancel' : 'Add recurring'}
          </button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-emerald-50 px-3.5 py-2 text-[13px] font-bold text-emerald-700" data-testid="recurring-monthly">
          ≈ {money(monthly)} / month committed
        </span>
        <span className="rounded-full bg-slate-100 px-3.5 py-2 text-[13px] font-bold text-slate-600">
          {rules.filter((r) => !r.paused).length} active rule{rules.filter((r) => !r.paused).length === 1 ? '' : 's'}
        </span>
        <Link href="/expenses" className="link-underline text-[13px] font-bold text-emerald-700">
          See posted entries in Daily Log
        </Link>
      </div>

      {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

      {open && (
        <form onSubmit={save} className="card mb-5 p-5 anim" data-testid="recurring-form">
          <h2 className="font-bold text-slate-900">New recurring payment</h2>
          <p className="text-xs text-slate-500">
            With auto-post on, the entry lands in your ledger on its due date — no cron needed, the schedule catches up
            whenever you open the app.
          </p>

          <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            <label className="label">
              Description
              <input
                className="input"
                placeholder="Netflix, rent, SIP…"
                value={form.description}
                onChange={(e) => setForm({...form, description: e.target.value})}
                required
                data-testid="recurring-description"
              />
            </label>
            <label className="label">
              Amount ({symbol})
              <input
                className="input"
                inputMode="decimal"
                placeholder="649"
                value={form.amount}
                onChange={(e) => setForm({...form, amount: e.target.value})}
                required
                data-testid="recurring-amount"
              />
            </label>
            <label className="label">
              Type
              <select className="input" value={form.type} onChange={(e) => setForm({...form, type: e.target.value})}>
                <option value="NEED">Need</option>
                <option value="WANT">Want</option>
                <option value="INCOME">Income</option>
              </select>
            </label>
            <label className="label">
              Category{form.type === 'INCOME' ? ' (optional)' : ''}
              <select
                className="input"
                required={form.type !== 'INCOME'}
                value={form.categoryId}
                onChange={(e) => setForm({...form, categoryId: e.target.value})}
                data-testid="recurring-category"
              >
                <option value="">{form.type === 'INCOME' ? 'No category' : 'Select category'}</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="label">
              Paid via
              <select className="input" value={form.paymentMethod} onChange={(e) => setMethod(e.target.value)}>
                <option value="UPI">UPI</option>
                <option value="CREDIT_CARD">Credit card</option>
                <option value="DEBIT_CARD">Debit card</option>
                <option value="BANK_TRANSFER">Bank transfer</option>
                <option value="CASH">Cash</option>
              </select>
            </label>
            {form.paymentMethod === 'CREDIT_CARD' && (
              <label className="label">
                Which card?
                <select
                  className="input"
                  required
                  value={form.creditCardId}
                  onChange={(e) => setForm({...form, creditCardId: e.target.value})}
                >
                  <option value="">Select a credit card…</option>
                  {cards.map((c) => (
                    <option key={c.id} value={c.id}>{c.cardName}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="label">
              Repeats
              <select
                className="input"
                value={form.interval}
                onChange={(e) => setForm({...form, interval: e.target.value})}
                data-testid="recurring-interval"
              >
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
                <option value="YEARLY">Yearly</option>
              </select>
            </label>
            <label className="label">
              First due
              <input
                className="input"
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({...form, startDate: e.target.value})}
                required
                data-testid="recurring-start"
              />
            </label>
            <label className="label">
              Ends (optional)
              <input className="input" type="date" value={form.endDate} onChange={(e) => setForm({...form, endDate: e.target.value})} />
            </label>
            <label className="label">
              Notes (optional)
              <input className="input" placeholder="plan details" value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})} />
            </label>
          </div>

          <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-3.5">
            <input
              type="checkbox"
              checked={form.autoPost}
              onChange={(e) => setForm({...form, autoPost: e.target.checked})}
              data-testid="recurring-autopost"
              className="h-4 w-4 accent-emerald-600"
            />
            <span className="text-[13px] font-semibold text-slate-700">
              Auto-post to my ledger when it&apos;s due (otherwise you&apos;ll get a reminder and can post it yourself)
            </span>
          </label>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button className="btn btn-primary" type="submit" disabled={busy} data-testid="recurring-save">
              {busy ? 'Saving…' : 'Create rule'}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {rules.length === 0 ? (
        <div className="card p-12 text-center">
          <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600">
            <Repeat size={22} />
          </span>
          <p className="font-semibold text-slate-700">No recurring payments yet</p>
          <p className="mt-1 text-sm text-slate-500">Add Netflix, rent, EMIs you pay outside the app, or your salary.</p>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="recurring-list">
          {rules.map((rule, index) => {
            const tone = countdown(rule);
            return (
              <li
                key={rule.id}
                className="card p-4 anim"
                data-testid="recurring-card"
                style={{['--d' as string]: `${Math.min(index, 10) * 35}ms`}}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-bold text-slate-900">{rule.description}</div>
                    <div className="mt-0.5 text-[12px] text-slate-500">
                      {rule.categoryName ?? rule.type} · {rule.interval.toLowerCase()}
                      {rule.cardName ? ` · ${rule.cardName}` : ''}
                    </div>
                  </div>
                  <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${tone.tone}`}>
                    {tone.label}
                  </span>
                </div>

                <div className="mt-3 flex items-baseline justify-between gap-2">
                  <span className="text-lg font-extrabold text-slate-900">
                    {rule.type === 'INCOME' ? '+' : ''}
                    {money(rule.amount)}
                  </span>
                  <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
                    <CalendarClock size={13} /> {fmtDay(rule.nextDueDate)}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                      rule.autoPost ? 'bg-emerald-50 text-emerald-700' : 'bg-sky-50 text-sky-700'
                    }`}
                  >
                    {rule.autoPost ? 'Auto-post' : 'Reminder only'}
                  </span>
                  {rule.endDate && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500">until {fmtDay(rule.endDate)}</span>}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    className="btn btn-soft !px-3 !py-2 text-[12.5px]"
                    disabled={busy || rule.paused}
                    onClick={() => postNow(rule)}
                    data-testid="recurring-post"
                  >
                    <Check size={14} strokeWidth={3} /> Post now
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost !px-3 !py-2 text-[12.5px]"
                    onClick={() => toggle(rule)}
                    data-testid="recurring-pause"
                  >
                    {rule.paused ? <Play size={14} /> : <Pause size={14} />}
                    {rule.paused ? 'Resume' : 'Pause'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost !px-3 !py-2 text-[12.5px] text-rose-500"
                    onClick={() => remove(rule)}
                    aria-label={`Delete ${rule.description}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
