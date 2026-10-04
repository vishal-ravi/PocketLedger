'use client';
import {useCallback, useEffect, useState} from 'react';
import {Header} from '@/components/header';
import {formatMoney, loadUser, useUser} from '@/lib/use-user';
import {Plus, Tags, Pencil, Trash2} from 'lucide-react';

type Category = {
  id: string;
  name: string;
  monthlyBudget: string | number;
  colorCode: string;
  spent: number;
  projected: number;
  rollover?: number;
  available?: number;
  taxDeductible?: boolean;
};

const emptyForm = {name: '', monthlyBudget: '', colorCode: '#10b981', taxDeductible: false};

export default function Budgets() {
  const [cats, setCats] = useState<Category[]>([]);
  const [form, setForm] = useState({...emptyForm});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rolloverBusy, setRolloverBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const user = useUser();
  const symbol = user?.currencySymbol ?? '₹';
  const money = (value: string | number) => formatMoney(value, symbol);

  const close = useCallback(() => {
    setOpen(false);
    setError('');
  }, []);

  const load = useCallback(() => {
    fetch('/api/categories')
      .then((r) => r.json())
      .then((d) => setCats(d.categories || []))
      .catch(() => setError('Could not load categories'));
  }, []);

  useEffect(() => {
    load();
    const timer = setTimeout(() => setMounted(true), 120);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, close]);

  function openCreate() {
    setForm({...emptyForm});
    setEditingId(null);
    setError('');
    setOpen(true);
  }

  function openEdit(category: Category) {
    setForm({
      name: category.name,
      monthlyBudget: String(category.monthlyBudget),
      colorCode: category.colorCode,
      taxDeductible: Boolean(category.taxDeductible),
    });
    setEditingId(category.id);
    setError('');
    setOpen(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = {...form, monthlyBudget: Number(form.monthlyBudget || 0)};
      const res = await fetch(editingId ? `/api/categories/${editingId}` : '/api/categories', {
        method: editingId ? 'PATCH' : 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not save category');
        return;
      }
      setOpen(false);
      load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(category: Category) {
    if (!window.confirm(`Delete category "${category.name}"?`)) return;
    const res = await fetch(`/api/categories/${category.id}`, {method: 'DELETE'});
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Could not delete category');
      return;
    }
    load();
  }

  async function toggleRollover() {
    setRolloverBusy(true);
    try {
      await fetch('/api/user', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({budgetRollover: !rolloverOn}),
      });
      await loadUser();
      load();
    } finally {
      setRolloverBusy(false);
    }
  }

  const rolloverOn = Boolean(user?.budgetRollover);
  const now = new Date();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toLocaleDateString('en-IN', {day: 'numeric', month: 'short'});

  const totalBudget = cats.reduce((sum, c) => sum + Number(c.monthlyBudget), 0);
  const totalRollover = rolloverOn ? cats.reduce((sum, c) => sum + (c.rollover ?? 0), 0) : 0;
  const totalAvailable = totalBudget + totalRollover;
  const totalSpent = cats.reduce((sum, c) => sum + c.spent, 0);
  const totalProjected = cats.reduce((sum, c) => sum + (c.projected ?? 0), 0);

  return (
    <>
      <Header
        title="Category Budgets"
        subtitle="Set monthly limits and watch actual spending."
        action={
          <button className="btn btn-primary" onClick={openCreate}>
            + Add category
          </button>
        }
      />

      <div className="card mb-5 flex flex-wrap items-center justify-between gap-4 p-5 anim" data-testid="budget-summary">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-100 text-emerald-700">
            <Tags size={20} />
          </span>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Month to date</div>
            <div className="text-xl font-extrabold text-slate-900">
              {money(totalSpent)} <span className="text-sm font-semibold text-slate-400">/ {money(totalAvailable)}</span>
            </div>
            <div className="text-[12px] font-semibold text-slate-500">
              Projected {money(totalProjected)} by {monthEnd}
              {totalRollover > 0 && <span className="ml-2 font-bold text-emerald-600">+{money(totalRollover)} rolled over</span>}
            </div>
          </div>
        </div>
        <div className="progress min-w-[220px] flex-1" data-tone={totalAvailable && totalSpent > totalAvailable ? 'over' : undefined}>
          <span style={{width: mounted && totalAvailable ? `${Math.min(100, (totalSpent / totalAvailable) * 100)}%` : '0%'}} />
        </div>
        <label className="flex cursor-pointer items-center gap-2.5 rounded-2xl border border-emerald-100 bg-emerald-50/60 px-3.5 py-2.5">
          <input
            type="checkbox"
            className="h-4 w-4 accent-emerald-600"
            checked={rolloverOn}
            disabled={rolloverBusy}
            onChange={toggleRollover}
            data-testid="rollover-toggle"
          />
          <span className="text-[12.5px] font-semibold text-slate-700">Roll unused budget into next month</span>
        </label>
      </div>

      {error && !open && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cats.map((c, index) => {
          const budget = Number(c.monthlyBudget);
          const carry = rolloverOn ? (c.rollover ?? 0) : 0;
          const available = budget + carry;
          const pct = available ? Math.min(100, (c.spent / available) * 100) : 0;
          const over = available > 0 && c.spent > available;
          const warn = available > 0 && !over && pct >= 80;
          return (
            <div
              className="card card-lift p-5 anim"
              key={c.id}
              style={{['--d' as string]: `${index * 60}ms`}}
            >
              <div className="flex items-center justify-between gap-3">
                <b className="flex items-center gap-2.5 text-slate-800">
                  <span className="inline-block h-3 w-3 rounded-full ring-4 ring-white" style={{background: c.colorCode}} />
                  {c.name}
                </b>
                <span className="flex items-center gap-2">
                  {c.taxDeductible && (
                    <span className="badge badge-income" data-testid="tax-badge">Tax deductible</span>
                  )}
                  <span className="text-[13px] font-semibold text-slate-500">
                    {money(c.spent)} <span className="text-slate-400">/ {money(available)}</span>
                  </span>
                </span>
              </div>

              <div className="progress mt-4" data-tone={over ? 'over' : warn ? 'warn' : undefined}>
                <span style={{width: mounted ? `${pct}%` : '0%'}} />
              </div>

              {carry > 0 && (
                <div className="mt-3 flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-xs" data-testid="rollover-badge">
                  <span className="font-semibold text-slate-500">Rolled over from last month</span>
                  <span className="font-bold text-emerald-600">+{money(carry)}</span>
                </div>
              )}

              {budget > 0 && (
                <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs">
                  <span className="font-semibold text-slate-500">Projected by {monthEnd}</span>
                  <span className={`font-bold ${c.projected > budget ? 'text-rose-600' : c.projected > budget * 0.9 ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {money(c.projected ?? 0)}
                    <span className="ml-1 font-semibold text-slate-400">vs {money(budget)}</span>
                  </span>
                </div>
              )}

              <div className="mt-3 flex items-center justify-between text-xs">
                <span className={`font-bold ${over ? 'text-rose-600' : warn ? 'text-amber-600' : 'text-slate-500'}`}>
                  {Math.round(pct)}% used{over ? ' — over budget' : warn ? ' — running high' : ''}
                </span>
                <span className="flex gap-3">
                  <button className="inline-flex items-center gap-1 font-semibold text-slate-500 transition hover:text-emerald-600" onClick={() => openEdit(c)}>
                    <Pencil size={13} /> Edit
                  </button>
                  <button className="inline-flex items-center gap-1 font-semibold text-rose-500 transition hover:text-rose-700" onClick={() => remove(c)}>
                    <Trash2 size={13} /> Delete
                  </button>
                </span>
              </div>
            </div>
          );
        })}

        <button
          className="anim grid min-h-[150px] place-items-center rounded-[18px] border-2 border-dashed border-emerald-200 bg-emerald-50/40 text-emerald-700 transition hover:-translate-y-1 hover:border-emerald-400 hover:bg-emerald-50"
          style={{['--d' as string]: `${cats.length * 60}ms`}}
          onClick={openCreate}
        >
          <span className="flex flex-col items-center gap-2 text-sm font-bold">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-600 text-white">
              <Plus size={20} strokeWidth={3} />
            </span>
            New category
          </span>
        </button>
      </div>

      {open && (
        <div className="overlay" onClick={close}>
          <form className="modal max-w-md" onClick={(e) => e.stopPropagation()} onSubmit={save}>
            <div className="modal-head">
              <div className="flex items-center gap-3">
                <span className="icon-tile">
                  <Tags size={20} />
                </span>
                <div>
                  <h2 className="text-lg font-extrabold">{editingId ? 'Edit Category' : 'Add Category'}</h2>
                  <p className="text-[12.5px] text-emerald-100/80">Budgets update instantly across the app</p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={close}
                className="grid h-9 w-9 place-items-center rounded-xl bg-white/15 transition hover:rotate-90 hover:bg-white/30"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 p-6">
              {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
              <div className="anim">
                <label className="label" htmlFor="c-name">Name *</label>
                <input id="c-name" required className="input" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} placeholder="e.g. Groceries" />
              </div>
              <div className="anim" style={{['--d' as string]: '80ms'}}>
                <label className="label" htmlFor="c-budget">Monthly budget</label>
                <input id="c-budget" type="number" min="0" step="0.01" className="input" value={form.monthlyBudget} onChange={(e) => setForm({...form, monthlyBudget: e.target.value})} placeholder="0" />
              </div>
              <div className="anim" style={{['--d' as string]: '140ms'}}>
                <label className="label" htmlFor="c-color">Colour</label>
                <div className="flex items-center gap-3">
                  <input id="c-color" className="h-11 w-16 cursor-pointer rounded-xl border border-slate-200 bg-white p-1" type="color" value={form.colorCode} onChange={(e) => setForm({...form, colorCode: e.target.value})} />
                  <span className="text-sm font-semibold text-slate-500">{form.colorCode}</span>
                </div>
              </div>
              <label className="anim flex cursor-pointer items-center gap-2.5 rounded-2xl border border-amber-100 bg-amber-50/60 px-3.5 py-2.5" style={{['--d' as string]: '200ms'}}>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-amber-600"
                  checked={form.taxDeductible}
                  onChange={(e) => setForm({...form, taxDeductible: e.target.checked})}
                  data-testid="tax-toggle"
                />
                <span className="text-[12.5px] font-semibold text-slate-700">Tax-deductible category (80C, rent, insurance…)</span>
              </label>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50/70 px-6 py-4">
              <button type="button" className="btn btn-ghost" onClick={close}>Cancel</button>
              <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save category'}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
