'use client';
import {useCallback, useEffect, useState} from 'react';
import {Header} from '@/components/header';
import {formatMoney, useUser} from '@/lib/use-user';
import {Landmark, Pencil, Trash2, Wallet} from 'lucide-react';

type Account = {id: string; name: string; type: string; balance: number};
type Card = {id: string; cardName: string; dues: number};
type Loan = {id: string; lenderName: string; outstanding: number};
type NetData = {
  accounts: Account[];
  cards: Card[];
  loans: Loan[];
  assets: number;
  cardDues: number;
  loanOutstanding: number;
  liabilities: number;
  netWorth: number;
};

const TYPES = [
  {value: 'BANK', label: 'Bank account'},
  {value: 'CASH', label: 'Cash'},
  {value: 'WALLET', label: 'Wallet / UPI balance'},
  {value: 'INVESTMENT', label: 'Investments'},
  {value: 'OTHER', label: 'Other'},
];

const emptyForm = {name: '', type: 'BANK', balance: ''};

export default function Accounts() {
  const [data, setData] = useState<NetData | null>(null);
  const [form, setForm] = useState({...emptyForm});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const user = useUser();
  const symbol = user?.currencySymbol ?? '₹';
  const money = (value: number) => formatMoney(value, symbol);

  const load = useCallback(() => {
    fetch('/api/analytics/networth')
      .then((r) => r.json())
      .then((d) => setData(d.accounts ? d : null))
      .catch(() => setError('Could not load net worth'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  function openCreate() {
    setForm({...emptyForm});
    setEditingId(null);
    setError('');
    setOpen(true);
  }

  function openEdit(account: Account) {
    setForm({name: account.name, type: account.type, balance: String(account.balance)});
    setEditingId(account.id);
    setError('');
    setOpen(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = {name: form.name.trim(), type: form.type, balance: Number(form.balance || 0)};
      const res = await fetch(editingId ? `/api/accounts/${editingId}` : '/api/accounts', {
        method: editingId ? 'PATCH' : 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not save account');
        return;
      }
      setOpen(false);
      load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(account: Account) {
    if (!window.confirm(`Delete account "${account.name}"?`)) return;
    const res = await fetch(`/api/accounts/${account.id}`, {method: 'DELETE'});
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Could not delete account');
      return;
    }
    load();
  }

  const negative = (data?.netWorth ?? 0) < 0;

  return (
    <>
      <Header
        title="Accounts & Net Worth"
        subtitle="Track bank balances, cash and what you owe."
        action={
          <button className="btn btn-primary" onClick={openCreate} data-testid="account-toggle">
            + Add account
          </button>
        }
      />

      <div className="card mb-5 flex flex-wrap items-center justify-between gap-5 p-5 anim" data-testid="net-worth-summary">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-indigo-100 text-indigo-700">
            <Landmark size={20} />
          </span>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Net worth</div>
            <div className={`text-2xl font-extrabold ${negative ? 'text-rose-600' : 'text-slate-900'}`} data-testid="net-worth-value">
              {negative ? '-' : ''}
              {money(Math.abs(data?.netWorth ?? 0))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-5 text-sm">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Assets</div>
            <div className="font-bold text-emerald-600" data-testid="assets-value">{money(data?.assets ?? 0)}</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Card dues</div>
            <div className="font-bold text-rose-600" data-testid="card-dues-value">{money(data?.cardDues ?? 0)}</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Loans</div>
            <div className="font-bold text-rose-600" data-testid="loan-dues-value">{money(data?.loanOutstanding ?? 0)}</div>
          </div>
        </div>
      </div>

      {error && !open && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-slate-900">Your accounts</h2>
            <span className="text-xs font-semibold text-slate-400">{(data?.accounts ?? []).length} tracked</span>
          </div>

          {!data || data.accounts.length === 0 ? (
            <div className="card p-10 text-center" data-testid="accounts-empty">
              <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-indigo-50 text-indigo-600">
                <Wallet size={22} />
              </span>
              <p className="font-semibold text-slate-700">No accounts yet</p>
              <p className="mt-1 text-sm text-slate-500">Add your bank, cash or wallet balances to see net worth.</p>
            </div>
          ) : (
            <ul className="grid gap-3" data-testid="account-list">
              {data.accounts.map((account, index) => (
                <li
                  className="card flex items-center justify-between gap-3 p-4 anim"
                  key={account.id}
                  data-testid="account-card"
                  style={{['--d' as string]: `${index * 40}ms`}}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-indigo-50 text-indigo-600">
                      <Wallet size={17} />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-bold text-slate-900">{account.name}</div>
                      <div className="text-[12px] text-slate-500">
                        {TYPES.find((t) => t.value === account.type)?.label ?? account.type}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-extrabold text-slate-900">{money(account.balance)}</span>
                    <button
                      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 transition hover:text-indigo-600"
                      onClick={() => openEdit(account)}
                      aria-label={`Edit ${account.name}`}
                    >
                      <Pencil size={13} /> Edit
                    </button>
                    <button
                      className="inline-flex items-center gap-1 text-xs font-semibold text-rose-500 transition hover:text-rose-700"
                      onClick={() => remove(account)}
                      aria-label={`Delete ${account.name}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-5">
          <div className="card p-5 anim" style={{['--d' as string]: '120ms'}}>
            <h2 className="font-bold text-slate-900">Card dues</h2>
            <p className="text-xs text-slate-500">Estimated outstanding on each card</p>
            <ul className="mt-3 space-y-2 text-sm" data-testid="card-dues-list">
              {(data?.cards ?? []).filter((c) => c.dues > 0).length === 0 ? (
                <li className="text-xs font-semibold text-slate-400">Nothing owed right now</li>
              ) : (
                (data?.cards ?? [])
                  .filter((c) => c.dues > 0)
                  .map((card) => (
                    <li key={card.id} className="flex items-center justify-between">
                      <span className="truncate font-semibold text-slate-700">{card.cardName}</span>
                      <span className="font-bold text-rose-600">{money(card.dues)}</span>
                    </li>
                  ))
              )}
            </ul>
          </div>

          <div className="card p-5 anim" style={{['--d' as string]: '180ms'}}>
            <h2 className="font-bold text-slate-900">Loans</h2>
            <p className="text-xs text-slate-500">Unpaid installments left</p>
            <ul className="mt-3 space-y-2 text-sm" data-testid="loan-dues-list">
              {(data?.loans ?? []).filter((l) => l.outstanding > 0).length === 0 ? (
                <li className="text-xs font-semibold text-slate-400">No active loans</li>
              ) : (
                (data?.loans ?? [])
                  .filter((l) => l.outstanding > 0)
                  .map((loan) => (
                    <li key={loan.id} className="flex items-center justify-between">
                      <span className="truncate font-semibold text-slate-700">{loan.lenderName}</span>
                      <span className="font-bold text-rose-600">{money(loan.outstanding)}</span>
                    </li>
                  ))
              )}
            </ul>
          </div>
        </div>
      </div>

      {open && (
        <div className="overlay" onClick={() => setOpen(false)}>
          <form
            className="modal max-w-md"
            onSubmit={save}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={editingId ? 'Edit account' : 'Add account'}
          >
            <div className="modal-head">
              <h3>{editingId ? 'Edit account' : 'Add account'}</h3>
            </div>

            {error && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

            <label className="label">
              Account name
              <input
                className="input"
                placeholder="HDFC savings"
                value={form.name}
                onChange={(e) => setForm({...form, name: e.target.value})}
                required
                data-testid="account-name"
              />
            </label>

            <label className="label">
              Type
              <select
                className="input"
                value={form.type}
                onChange={(e) => setForm({...form, type: e.target.value})}
                data-testid="account-type"
              >
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="label">
              Current balance ({symbol})
              <input
                className="input"
                inputMode="decimal"
                placeholder="25000"
                value={form.balance}
                onChange={(e) => setForm({...form, balance: e.target.value})}
                required
                data-testid="account-balance"
              />
            </label>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button className="btn btn-primary" type="submit" disabled={busy} data-testid="account-save">
                {busy ? 'Saving…' : editingId ? 'Save account' : 'Add account'}
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
