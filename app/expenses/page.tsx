'use client';
import {useCallback, useEffect, useRef, useState} from 'react';
import Link from 'next/link';
import {Header} from '@/components/header';
import {formatMoney, useUser} from '@/lib/use-user';
import {formatDate, todayLocal} from '@/lib/money';
import {FX_CURRENCIES, convertToBase, formatFxNote} from '@/lib/fx';
import {Check, CreditCard, Plus, Receipt, Split, Trash2, UserRound, Wallet, X, Zap} from 'lucide-react';

type Category = {id: string; name: string};
type Card = {id: string; cardName: string; available?: number | string};
type Expense = {
  id: string;
  date: string;
  description: string;
  amount: string | number;
  paymentMethod: string;
  creditCardId?: string | null;
  type: string;
  notes?: string | null;
  categoryId: string | null;
  category?: {name: string};
  creditCard?: {cardName: string};
  splitDetails?: {personName: string; amountOwedToMe: string | number}[];
  originalAmount?: string | number | null;
  originalCurrency?: string | null;
  fxRate?: string | number | null;
};

type FxState = {on: boolean; currency: string; originalAmount: string; rate: string};

const emptyFx: FxState = {on: false, currency: 'USD', originalAmount: '', rate: ''};
type SplitRow = {personName: string; amountOwedToMe: string};
type Mode = 'personal' | 'split' | 'someone';

const emptyForm = {
  description: '',
  amount: '',
  categoryId: '',
  paymentMethod: 'UPI',
  creditCardId: '',
  type: 'NEED',
  date: todayLocal(),
  notes: '',
};

const quickPicks = ['Breakfast', 'Lunch', 'Dinner', 'Groceries', 'Coffee', 'Tea & Snacks', 'Travel', 'Movie'];
const PAGE_SIZE = 50;
const quickModes = [
  {value: 'UPI', label: 'UPI', icon: Zap},
  {value: 'CASH', label: 'ATM Cash', icon: Wallet},
  {value: 'CREDIT_CARD', label: 'Credit Card', icon: CreditCard},
];

const typeOptions = [
  {value: 'NEED', label: 'Need', hint: 'Essential', tone: 'emerald'},
  {value: 'WANT', label: 'Want', hint: 'Lifestyle', tone: 'violet'},
  {value: 'INCOME', label: 'Income', hint: 'Money in', tone: 'amber'},
] as const;

const modes = [
  {value: 'personal', label: 'Personal', hint: '100% my expense', Icon: UserRound},
  {value: 'split', label: 'Split Bill', hint: 'Shared with others', Icon: Split},
  {value: 'someone', label: 'Paid for Someone', hint: 'They owe me back', Icon: Receipt},
] as const;

export default function Expenses() {
  const [rows, setRows] = useState<Expense[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [cats, setCats] = useState<Category[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [month, setMonth] = useState('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cardFilter, setCardFilter] = useState('');
  const [form, setForm] = useState({...emptyForm});
  const [mode, setMode] = useState<Mode>('personal');
  const [splits, setSplits] = useState<SplitRow[]>([{personName: '', amountOwedToMe: ''}]);
  const [fx, setFx] = useState<FxState>(emptyFx);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const user = useUser();
  const symbol = user?.currencySymbol ?? '₹';
  const money = (value: string | number) => formatMoney(value, symbol);

  const close = useCallback(() => {
    setOpen(false);
    setError('');
  }, []);

  const filterParams = useCallback(() => {
    const params = new URLSearchParams();
    if (month) params.set('month', month);
    if (query.trim()) params.set('q', query.trim());
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (cardFilter) params.set('creditCardId', cardFilter);
    return params;
  }, [month, query, from, to, cardFilter]);

  const load = useCallback(() => {
    const params = filterParams();
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', '0');
    fetch(`/api/expenses?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setRows(d.expenses || []);
        setTotal(d.total ?? (d.expenses || []).length);
        setHasMore(Boolean(d.hasMore));
      })
      .catch(() => setError('Could not load transactions'));
  }, [filterParams]);

  const loadMore = useCallback(() => {
    const params = filterParams();
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(rows.length));
    fetch(`/api/expenses?${params}`)
      .then((r) => r.json())
      .then((d) => {
        const next = d.expenses || [];
        setRows((current) => [...current, ...next]);
        setTotal(d.total ?? rows.length + next.length);
        setHasMore(Boolean(d.hasMore));
      })
      .catch(() => setError('Could not load transactions'));
  }, [filterParams, rows.length]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    fetch('/api/categories')
      .then((r) => r.json())
      .then((d) => setCats(d.categories || []))
      .catch(() => setCats([]));
  }, []);

  useEffect(() => {
    fetch('/api/credit-cards')
      .then((r) => r.json())
      .then((d) => setCards(d.cards || []))
      .catch(() => setCards([]));
  }, []);

  function setPaymentMethod(value: string) {
    setForm((current) => {
      if (value !== 'CREDIT_CARD') return {...current, paymentMethod: value, creditCardId: ''};
      const picked = current.creditCardId || (cards.length === 1 ? cards[0].id : '');
      return {...current, paymentMethod: value, creditCardId: picked};
    });
  }

  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || !cats.length || open) return;
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get('new');
    if (wanted !== '1' && wanted !== 'income') return;
    autoOpened.current = true;
    if (wanted === 'income') openIncome();
    else openCreate();
    params.delete('new');
    const query = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cats, open]);

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

  function applyFx(next: FxState) {
    setFx(next);
    if (next.on && Number(next.originalAmount) > 0 && Number(next.rate) > 0) {
      setForm((current) => ({...current, amount: String(convertToBase(next.originalAmount, next.rate))}));
    }
  }

  function openCreate() {
    setForm({...emptyForm, categoryId: cats[0]?.id ?? ''});
    setFx(emptyFx);
    setMode('personal');
    setSplits([{personName: '', amountOwedToMe: ''}]);
    setEditingId(null);
    setError('');
    setOpen(true);
  }

  function openIncome() {
    setForm({...emptyForm, type: 'INCOME', categoryId: '', paymentMethod: 'UPI'});
    setFx(emptyFx);
    setMode('personal');
    setSplits([{personName: '', amountOwedToMe: ''}]);
    setEditingId(null);
    setError('');
    setOpen(true);
  }

  function openEdit(row: Expense) {
    setFx({
      on: Boolean(row.originalCurrency),
      currency: row.originalCurrency ?? emptyFx.currency,
      originalAmount: row.originalAmount != null ? String(row.originalAmount) : '',
      rate: row.fxRate != null ? String(row.fxRate) : '',
    });
    setForm({
      description: row.description,
      amount: String(row.amount),
      categoryId: row.categoryId ?? '',
      paymentMethod: row.paymentMethod,
      creditCardId: row.creditCardId ?? '',
      type: row.type,
      date: row.date.slice(0, 10),
      notes: row.notes ?? '',
    });
    const existing = row.splitDetails ?? [];
    setMode(existing.length ? 'split' : 'personal');
    setSplits(existing.length ? existing.map((s) => ({personName: s.personName, amountOwedToMe: String(s.amountOwedToMe)})) : [{personName: '', amountOwedToMe: ''}]);
    setEditingId(row.id);
    setError('');
    setOpen(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const cleanSplits = splits
        .filter((row) => row.personName.trim() && Number(row.amountOwedToMe) > 0)
        .map((row) => ({personName: row.personName.trim(), amountOwedToMe: Number(row.amountOwedToMe)}));

      const payload = {
        ...form,
        notes: form.notes || null,
        categoryId: form.categoryId || null,
        creditCardId: form.type !== 'INCOME' && form.paymentMethod === 'CREDIT_CARD' && form.creditCardId ? form.creditCardId : null,
        amount: Number(form.amount),
        date: form.date,
        isSplit: form.type !== 'INCOME' && mode !== 'personal' && cleanSplits.length > 0,
        whoPaid: 'Me',
        originalCurrency: fx.on && Number(fx.originalAmount) > 0 && Number(fx.rate) > 0 ? fx.currency : null,
        originalAmount: fx.on && Number(fx.originalAmount) > 0 && Number(fx.rate) > 0 ? Number(fx.originalAmount) : null,
        fxRate: fx.on && Number(fx.originalAmount) > 0 && Number(fx.rate) > 0 ? Number(fx.rate) : null,
        splits: form.type !== 'INCOME' && mode !== 'personal' ? cleanSplits : [],
      };

      const res = await fetch(editingId ? `/api/expenses/${editingId}` : '/api/expenses', {
        method: editingId ? 'PATCH' : 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not save transaction');
        return;
      }
      setOpen(false);
      load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: Expense) {
    if (!window.confirm(`Delete "${row.description}"?`)) return;
    const res = await fetch(`/api/expenses/${row.id}`, {method: 'DELETE'});
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Could not delete transaction');
      return;
    }
    load();
  }

  const badge = (type: string) =>
    type === 'NEED' ? 'badge badge-need' : type === 'WANT' ? 'badge badge-want' : 'badge badge-income';

  return (
    <>
      <Header
        title="Daily Log"
        subtitle="Track every transaction and tag it as a need, want or income."
        action={
          <>
            <button className="btn btn-soft" onClick={openIncome} data-testid="add-income">
              + Add income
            </button>
            <button className="btn btn-primary" onClick={openCreate} data-testid="add-expense">
              + Add expense
            </button>
          </>
        }
      />

      <div className="card mb-5 flex flex-col gap-3 p-4 anim sm:flex-row sm:flex-wrap sm:items-center">
        <input
          className="input sm:max-w-xs"
          placeholder="Search description…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <input className="input sm:max-w-xs" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-500">
          From
          <input className="input w-[9.5rem]" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-500">
          To
          <input className="input w-[9.5rem]" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <select
          className="input sm:max-w-[13rem]"
          aria-label="Filter by card"
          value={cardFilter}
          onChange={(e) => setCardFilter(e.target.value)}
          data-testid="card-filter"
        >
          <option value="">All cards</option>
          {cards.map((c) => (
            <option key={c.id} value={c.id}>{c.cardName}</option>
          ))}
        </select>
        {(query || month || from || to || cardFilter) && (
          <button
            className="btn btn-ghost"
            onClick={() => {
              setQuery('');
              setMonth('');
              setFrom('');
              setTo('');
              setCardFilter('');
            }}
          >
            Clear filters
          </button>
        )}
        <span className="ml-auto flex items-center gap-3">
          <Link className="btn btn-soft" href="/import" data-testid="import-link">
            Import
          </Link>
          <a className="btn btn-soft" href={`/api/expenses/export?${filterParams()}`} download>
            Export CSV
          </a>
          <span className="text-xs font-semibold text-slate-500">{rows.length} shown</span>
        </span>
      </div>

      {error && !open && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

      <div className="card overflow-hidden anim" style={{['--d' as string]: '120ms'}}>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
                <th>Payment</th>
                <th>Class</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id} className="anim" style={{['--d' as string]: `${Math.min(index, 12) * 35}ms`}}>
                  <td className="whitespace-nowrap text-slate-500">{formatDate(row.date)}</td>
                  <td className="font-semibold text-slate-800">{row.description}</td>
                  <td>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                      {row.category?.name ?? '—'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap text-slate-500">
                    {row.paymentMethod === 'CREDIT_CARD' && row.creditCard?.cardName
                      ? row.creditCard.cardName
                      : row.paymentMethod.replace('_', ' ')}
                  </td>
                  <td>
                    <span className={badge(row.type)}>{row.type}</span>
                  </td>
                  <td
                    className={`text-right font-bold ${row.type === 'INCOME' ? 'text-emerald-600' : 'text-slate-900'}`}
                    data-testid={row.type === 'INCOME' ? 'income-amount' : undefined}
                  >
                    {row.type === 'INCOME' ? '+' : ''}
                    {money(row.amount)}
                    {row.originalCurrency ? (
                      <div className="text-[10.5px] font-semibold text-slate-400" data-testid="fx-note">
                        {row.originalCurrency} {Number(row.originalAmount)} @ {Number(row.fxRate)}
                      </div>
                    ) : null}
                  </td>
                  <td className="text-right">
                    <span className="row-actions">
                      <button className="text-xs font-semibold text-emerald-600 hover:text-emerald-800" onClick={() => openEdit(row)}>
                        Edit
                      </button>
                      <button className="text-xs font-semibold text-rose-500 hover:text-rose-700" onClick={() => remove(row)}>
                        Delete
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="p-12 text-center">
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600">
                <Receipt size={22} />
              </div>
              <p className="font-semibold text-slate-700">No transactions found</p>
              <p className="mt-1 text-sm text-slate-500">Add your first entry or clear the filters.</p>
            </div>
          )}
          {rows.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-3 border-t border-slate-100 px-4 py-3.5" data-testid="list-footer">
              {hasMore && (
                <button type="button" className="btn btn-soft" onClick={loadMore} data-testid="load-more">
                  Load more
                </button>
              )}
              <span className="text-[13px] text-slate-500">
                Showing {rows.length} of {total} transactions
              </span>
            </div>
          )}
        </div>
      </div>

      {open && (
        <div className="overlay" onClick={close}>
          <form
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={save}
          >
            <div className="modal-head">
              <div className="flex items-start gap-3">
                <span className="icon-tile">
                  <Plus size={20} strokeWidth={3} />
                </span>
                <div>
                  <h2 className="text-lg font-extrabold">
                    {editingId ? 'Edit Transaction' : form.type === 'INCOME' ? 'Add Income' : 'Log New Expense'}
                  </h2>
                  <p className="text-[12.5px] text-emerald-100/80">
                    {form.type === 'INCOME'
                      ? 'Counts towards your total income and reduces your net balance when you spend'
                      : 'Syncs automatically with your balances, budgets &amp; category summaries'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={close}
                className="grid h-9 w-9 place-items-center rounded-xl bg-white/15 transition hover:bg-white/30 hover:rotate-90"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 md:p-6">
              {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

              <div className="anim mb-5 flex flex-wrap items-center gap-2.5 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3" style={{['--d' as string]: '60ms'}}>
                <span className="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wider text-emerald-700">
                  <Zap size={14} /> Quick modes
                </span>
                {quickModes
                  .filter((mode) => form.type !== 'INCOME' || mode.value !== 'CREDIT_CARD')
                  .map(({value, label, icon: Icon}) => (
                  <button
                    key={value}
                    type="button"
                    className="chip"
                    data-active={form.paymentMethod === value}
                    onClick={() => setPaymentMethod(value)}
                  >
                    <Icon size={14} /> {label}
                  </button>
                ))}
              </div>

              {form.type !== 'INCOME' && form.paymentMethod === 'CREDIT_CARD' && (
                <div className="anim mt-4" style={{['--d' as string]: '80ms'}}>
                  <label className="label" htmlFor="f-card">
                    Which card was used? *
                  </label>
                  {cards.length > 0 ? (
                    <>
                      <select
                        id="f-card"
                        required
                        className="input"
                        data-testid="expense-card-select"
                        value={form.creditCardId}
                        onChange={(e) => setForm({...form, creditCardId: e.target.value})}
                      >
                        <option value="">Select a credit card…</option>
                        {cards.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.cardName} — {money(c.available ?? 0)} available
                          </option>
                        ))}
                      </select>
                      <p className="mt-2 text-xs font-semibold text-slate-400">
                        This amount is added to that card&apos;s spend, utilisation and projected bill.
                      </p>
                    </>
                  ) : (
                    <p className="text-xs font-semibold text-amber-600">
                      No cards yet — add one on the{' '}
                      <Link href="/cards" className="underline">
                        Cards
                      </Link>{' '}
                      page so this purchase counts against a card limit.
                    </p>
                  )}
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="anim" style={{['--d' as string]: '100ms'}}>
                  <label className="label" htmlFor="f-date">Date *</label>
                  <input id="f-date" required type="date" className="input" value={form.date} onChange={(e) => setForm({...form, date: e.target.value})} />
                </div>
                <div className="anim" style={{['--d' as string]: '140ms'}}>
                  <label className="label" htmlFor="f-cat">
                    Category{form.type === 'INCOME' ? ' (optional)' : ' *'}
                  </label>
                  <select
                    id="f-cat"
                    required={form.type !== 'INCOME'}
                    className="input"
                    value={form.categoryId}
                    onChange={(e) => setForm({...form, categoryId: e.target.value})}
                  >
                    <option value="">{form.type === 'INCOME' ? 'No category — just record the source' : 'Select category'}</option>
                    {cats.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  {form.type === 'INCOME' && (
                    <p className="mt-2 text-xs font-semibold text-slate-400">
                      Income never counts against budgets — the description is your source (e.g. “Salary”, “Gift”).
                    </p>
                  )}
                  {form.type !== 'INCOME' && cats.length === 0 && (
                    <p className="mt-2 text-xs font-semibold text-amber-600">
                      No categories yet — create one on the{' '}
                      <Link href="/budgets" className="underline">
                        Categories
                      </Link>{' '}
                      page first.
                    </p>
                  )}
                </div>
              </div>

              <div className="anim mt-4" style={{['--d' as string]: '180ms'}}>
                <label className="label" htmlFor="f-desc">
                  {form.type === 'INCOME' ? 'Source / received from *' : 'Description / Item *'}
                </label>
                <input
                  id="f-desc"
                  required
                  className="input"
                  placeholder={form.type === 'INCOME' ? 'e.g. Salary October, Freelance payout, Gift from Priya…' : 'e.g. Breakfast, Groceries, Movie Tickets…'}
                  value={form.description}
                  onChange={(e) => setForm({...form, description: e.target.value})}
                />
                {form.type !== 'INCOME' && (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <span className="self-center text-[11px] font-semibold uppercase tracking-wider text-slate-400">Quick pick</span>
                    {quickPicks.map((pick) => (
                      <button
                        key={pick}
                        type="button"
                        className="chip"
                        data-active={form.description === pick}
                        onClick={() => setForm({...form, description: pick})}
                      >
                        {pick}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="anim" style={{['--d' as string]: '220ms'}}>
                  <label className="label" htmlFor="f-amount">Amount ({symbol}) *</label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-slate-400">{symbol}</span>
                    <input
                      id="f-amount"
                      required
                      type="number"
                      min="0"
                      step="0.01"
                      className="input pl-9 text-lg font-bold"
                      placeholder="0.00"
                      value={form.amount}
                      onChange={(e) => setForm({...form, amount: e.target.value})}
                    />
                  </div>
                  <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-500">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-emerald-600"
                      checked={fx.on}
                      onChange={(e) => applyFx({...fx, on: e.target.checked})}
                      data-testid="fx-toggle"
                    />
                    Paid in a foreign currency
                  </label>
                  {fx.on && (
                    <div className="mt-2 space-y-2" data-testid="fx-fields">
                      <select
                        className="input"
                        value={fx.currency}
                        onChange={(e) => applyFx({...fx, currency: e.target.value})}
                        data-testid="original-currency"
                      >
                        {FX_CURRENCIES.map((code) => (
                          <option key={code} value={code}>
                            {code}
                          </option>
                        ))}
                      </select>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          className="input"
                          inputMode="decimal"
                          placeholder="Original amount"
                          value={fx.originalAmount}
                          onChange={(e) => applyFx({...fx, originalAmount: e.target.value})}
                          data-testid="original-amount"
                        />
                        <input
                          className="input"
                          inputMode="decimal"
                          step="0.0001"
                          placeholder="Rate → base"
                          value={fx.rate}
                          onChange={(e) => applyFx({...fx, rate: e.target.value})}
                          data-testid="fx-rate"
                        />
                      </div>
                      <p className="text-[11.5px] font-bold text-emerald-600" data-testid="fx-preview">
                        {Number(fx.originalAmount) > 0 && Number(fx.rate) > 0
                          ? formatFxNote(fx.originalAmount, fx.currency, fx.rate, symbol)
                          : 'Enter the original amount and rate to convert'}
                      </p>
                    </div>
                  )}
                </div>
                <div className="anim" style={{['--d' as string]: '260ms'}}>
                  <span className="label">Expense classification *</span>
                  <div className="seg sm:grid-cols-3">
                    {typeOptions.map(({value, label, hint, tone}) => (
                      <button
                        key={value}
                        type="button"
                        className="seg-btn"
                        data-tone={tone}
                        data-active={form.type === value}
                        onClick={() =>
                          setForm({
                            ...form,
                            type: value,
                            ...(value === 'INCOME' && form.paymentMethod === 'CREDIT_CARD' ? {paymentMethod: 'UPI'} : {}),
                          })
                        }
                      >
                        <span className="text-sm font-bold">{label}</span>
                        <span className="text-[11px] text-slate-500">{hint}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="anim" style={{['--d' as string]: '300ms'}}>
                  <label className="label" htmlFor="f-pay">Payment method *</label>
                  <select id="f-pay" className="input" value={form.paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                    <option>UPI</option>
                    {form.type !== 'INCOME' && <option>CREDIT_CARD</option>}
                    <option>CASH</option>
                    <option>DEBIT_CARD</option>
                    <option>BANK_TRANSFER</option>
                  </select>
                </div>
                <div className="anim" style={{['--d' as string]: '340ms'}}>
                  <label className="label" htmlFor="f-notes">Notes (optional)</label>
                  <input id="f-notes" className="input" placeholder="e.g. Paid via Google Pay" value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})} />
                </div>
              </div>

              {form.type !== 'INCOME' && (
                <div className="anim mt-5 rounded-2xl border border-slate-200 bg-slate-50/70 p-4" style={{['--d' as string]: '380ms'}}>
                  <span className="label">Who is this expense for?</span>
                <div className="seg mt-1 sm:grid-cols-3">
                  {modes.map(({value, label, hint, Icon}) => (
                    <button
                      key={value}
                      type="button"
                      className="seg-btn"
                      data-active={mode === value}
                      onClick={() => setMode(value as Mode)}
                    >
                      <span className="flex items-center gap-2 text-sm font-bold">
                        <Icon size={15} /> {label}
                      </span>
                      <span className="text-[11px] text-slate-500">{hint}</span>
                    </button>
                  ))}
                </div>

                {mode !== 'personal' && (
                  <div className="anim-fade mt-4 space-y-2.5">
                    {splits.map((row, index) => (
                      <div key={index} className="flex flex-col gap-2 sm:flex-row">
                        <input
                          className="input sm:flex-1"
                          placeholder="Who did you pay for?"
                          value={row.personName}
                          onChange={(e) => setSplits(splits.map((r, i) => (i === index ? {...r, personName: e.target.value} : r)))}
                        />
                        <div className="relative sm:w-44">
                          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">{symbol}</span>
                          <input
                            className="input pl-9"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="They owe you"
                            value={row.amountOwedToMe}
                            onChange={(e) => setSplits(splits.map((r, i) => (i === index ? {...r, amountOwedToMe: e.target.value} : r)))}
                          />
                        </div>
                        <button
                          type="button"
                          aria-label="Remove row"
                          className="btn btn-ghost sm:w-11 sm:px-0"
                          onClick={() => setSplits(splits.length > 1 ? splits.filter((_, i) => i !== index) : splits)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn btn-soft"
                      onClick={() => setSplits([...splits, {personName: '', amountOwedToMe: ''}])}
                    >
                      <Plus size={15} strokeWidth={3} /> Add person
                    </button>
                  </div>
                )}
              </div>
              )}
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-slate-100 bg-slate-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-end md:px-6">
              <button type="button" className="btn btn-ghost" onClick={close}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={busy}>
                <Check size={16} strokeWidth={3} />
                {busy
                  ? 'Saving…'
                  : editingId
                    ? 'Update transaction'
                    : form.type === 'INCOME'
                      ? 'Save income'
                      : 'Save & append to sheet'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
