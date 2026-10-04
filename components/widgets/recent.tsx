'use client';
import {useEffect, useState} from 'react';
import Link from 'next/link';
import {CheckCircle2, Plus, XCircle} from 'lucide-react';
import {inr} from '@/lib/use-count-up';
import type {RecentRow} from '@/lib/dashboard';

type Category = {id: string; name: string; colorCode: string};

const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', {day: 'numeric', month: 'short'});

export function Recent({rows, symbol, today, onSaved}: {rows: RecentRow[]; symbol: string; today: string; onSaved: () => void}) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [type, setType] = useState('NEED');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ok: boolean; text: string} | null>(null);

  useEffect(() => {
    fetch('/api/categories')
      .then((r) => r.json())
      .then((d) => {
        const list: Category[] = d.categories || [];
        setCategories(list);
        setCategoryId((prev) => prev || list[0]?.id || '');
      })
      .catch(() => setCategories([]));
  }, []);

  async function quickAdd(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(amount);
    if (!value || value <= 0) {
      setNote({ok: false, text: 'Enter an amount greater than 0'});
      return;
    }
    if (!description.trim()) {
      setNote({ok: false, text: 'Add a short description'});
      return;
    }
    if (type !== 'INCOME' && !categoryId) {
      setNote({ok: false, text: 'Create a category first'});
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          date: today,
          description: description.trim(),
          categoryId: type === 'INCOME' ? null : categoryId,
          paymentMethod: 'UPI',
          amount: value,
          type,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNote({ok: false, text: data.error || 'Could not save'});
        return;
      }
      setNote({ok: true, text: 'Added — dashboard refreshed'});
      setAmount('');
      setDescription('');
      onSaved();
    } catch {
      setNote({ok: false, text: 'Network error'});
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5 anim" data-testid="recent-list" style={{['--d' as string]: '260ms'}}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-slate-900">Recent transactions</h2>
          <p className="text-xs text-slate-500">Your latest five entries</p>
        </div>
        <Link href="/expenses" className="link-underline text-xs font-bold text-emerald-700">
          View all
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
          No transactions yet — add your first one below.
        </p>
      ) : (
        <ul className="mb-4 space-y-2.5">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3">
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[11px] font-extrabold text-white"
                style={{background: row.color}}
              >
                {row.category.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-bold text-slate-900">{row.description}</div>
                <div className="truncate text-[11.5px] text-slate-500">
                  {row.category} · {fmtDay(row.date)} · {row.method.replace('_', ' ').toLowerCase()}
                </div>
              </div>
              <span
                className={`shrink-0 text-[14px] font-extrabold ${
                  row.type === 'INCOME' ? 'text-emerald-600' : 'text-slate-900'
                }`}
              >
                {row.type === 'INCOME' ? '+' : '−'}
                {inr(row.amount, symbol)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={quickAdd} className="rounded-2xl bg-slate-50 p-4" data-testid="quick-add">
        <div className="mb-2.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
          <Plus size={13} /> Quick add
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <label className="label">
            Amount
            <input
              className="input"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              data-testid="quick-amount"
            />
          </label>
          <label className="label">
            Description
            <input
              className="input"
              placeholder="e.g. Auto ride"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="quick-description"
            />
          </label>
          {type !== 'INCOME' && (
            <label className="label">
              Category
              <select
                className="input"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                data-testid="quick-category"
              >
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="label">
            Type
            <select className="input" value={type} onChange={(e) => setType(e.target.value)} data-testid="quick-type">
              <option value="NEED">Need</option>
              <option value="WANT">Want</option>
              <option value="INCOME">Income</option>
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button className="btn btn-primary" type="submit" disabled={busy} data-testid="quick-save">
            {busy ? 'Saving…' : 'Add transaction'}
          </button>
          {note && (
            <span
              className={`flex items-center gap-1.5 text-[12.5px] font-semibold ${
                note.ok ? 'text-emerald-600' : 'text-rose-600'
              }`}
              data-testid="quick-note"
            >
              {note.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
              {note.text}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
