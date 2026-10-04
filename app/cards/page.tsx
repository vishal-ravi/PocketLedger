'use client';
import {useCallback, useEffect, useState} from 'react';
import {Header} from '@/components/header';
import {formatMoney, useUser} from '@/lib/use-user';
import {formatDate} from '@/lib/money';
import {AlertTriangle, CalendarDays, CreditCard, Percent, Plus, Gift, Receipt, Trash2, TrendingUp, Wallet} from 'lucide-react';

type MiniRow = {month: string; amount: number};
type SplitRow = {name: string; color: string; amount: number};

type Card = {
  id: string;
  cardName: string;
  notes?: string | null;
  creditLimit: number;
  apr: number | null;
  rewardsRate: number | null;
  statementGenerationDay: number;
  dueDay: number;
  monthSpend: number;
  cycleSpend: number;
  available: number;
  utilisation: number;
  cycleUtilisation: number;
  band: 'excellent' | 'good' | 'fair' | 'high';
  cycle: {start: string; end: string; daysLeft: number; totalDays: number; elapsed: number};
  statementDate: string;
  daysToStatement: number;
  dueDate: string;
  daysToDue: number;
  projectedBill: number;
  minDue: number;
  interest: number | null;
  rewards: number | null;
  monthly: MiniRow[];
  categorySplit: SplitRow[];
  transactionCount: number;
};

type Totals = {
  creditLimit: number;
  monthSpend: number;
  cycleSpend: number;
  projectedBill: number;
  available: number;
  rewards: number;
  interest: number;
  utilisation: number;
  dueSoon: number;
  totalCards: number;
};

const emptyForm = {
  cardName: '',
  creditLimit: '',
  statementGenerationDay: '1',
  dueDay: '1',
  apr: '',
  rewardsRate: '',
  notes: '',
};

const bandLabel: Record<Card['band'], string> = {
  excellent: 'Excellent',
  good: 'Healthy',
  fair: 'Fair use',
  high: 'High use',
};

const bandClass: Record<Card['band'], string> = {
  excellent: 'badge badge-need',
  good: 'badge badge-need',
  fair: 'badge badge-want',
  high: 'badge badge-income',
};

export default function Cards() {
  const [cards, setCards] = useState<Card[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [form, setForm] = useState({...emptyForm});
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const user = useUser();
  const symbol = user?.currencySymbol ?? '₹';
  const money = (value: number) => formatMoney(value, symbol);

  const close = useCallback(() => {
    setOpen(false);
    setError('');
  }, []);

  const load = useCallback(() => {
    fetch('/api/analytics/cards')
      .then((r) => r.json())
      .then((d) => {
        setCards(d.cards || []);
        setTotals(d.totals || null);
      })
      .catch(() => setError('Could not load cards'));
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

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = {
        cardName: form.cardName,
        notes: form.notes || null,
        creditLimit: Number(form.creditLimit),
        statementGenerationDay: Number(form.statementGenerationDay),
        dueDay: Number(form.dueDay),
        apr: form.apr === '' ? null : Number(form.apr),
        rewardsRate: form.rewardsRate === '' ? null : Number(form.rewardsRate),
      };
      const res = await fetch('/api/credit-cards', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not save card');
        return;
      }
      setOpen(false);
      setForm({...emptyForm});
      load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(card: Card) {
    if (!window.confirm(`Delete "${card.cardName}"? Transactions on it will be kept.`)) return;
    const res = await fetch(`/api/credit-cards/${card.id}`, {method: 'DELETE'});
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Could not delete card');
      return;
    }
    load();
  }

  const overallTone = totals && totals.utilisation > 75 ? 'over' : totals && totals.utilisation > 50 ? 'warn' : undefined;

  return (
    <>
      <Header
        title="Credit Cards"
        subtitle="Limits, billing cycles, utilisation health and projected bills."
        action={
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            + Add card
          </button>
        }
      />

      <section className="hero p-5 md:p-6 anim">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200/40 bg-white/10 px-3.5 py-1.5 text-[12.5px] font-semibold text-emerald-50">
            <Wallet size={14} /> {totals?.totalCards ?? 0} cards tracked
          </span>
          <span className="text-[12px] text-emerald-100/70">
            {totals && totals.dueSoon > 0 ? `${totals.dueSoon} payment(s) due within 5 days` : 'All payments on schedule'}
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            {label: 'Combined Limit', value: money(totals?.creditLimit ?? 0), sub: 'Total credit available'},
            {label: 'Used This Month', value: money(totals?.monthSpend ?? 0), sub: `Projected bill ${money(totals?.projectedBill ?? 0)}`},
            {label: 'Available Credit', value: money(totals?.available ?? 0), sub: 'Across every card'},
            {label: 'Overall Utilisation', value: `${Math.round(totals?.utilisation ?? 0)}%`, sub: 'Keep it under 30% for your score'},
          ].map((stat, index) => (
            <div key={stat.label} className="dark-card p-5 anim" style={{['--d' as string]: `${index * 70}ms`}}>
              <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-emerald-100/70">{stat.label}</div>
              <div className="mt-3 text-[26px] font-extrabold leading-none tracking-tight text-white">{stat.value}</div>
              <div className="mt-2.5 text-[12px] text-emerald-100/70">{stat.sub}</div>
            </div>
          ))}
        </div>

        <div className="progress mt-5" data-tone={overallTone}>
          <span style={{width: mounted ? `${Math.min(100, totals?.utilisation ?? 0)}%` : '0%'}} />
        </div>
      </section>

      {totals && totals.dueSoon > 0 && (
        <div className="mt-5 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm font-semibold text-amber-800 anim">
          <AlertTriangle size={16} className="shrink-0" />
          {totals.dueSoon} card payment{totals.dueSoon > 1 ? 's are' : ' is'} due in the next 5 days — clear them to avoid interest.
        </div>
      )}

      {error && !open && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

      <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((c, index) => {
          const limit = c.creditLimit;
          const pct = limit ? Math.min(100, (c.monthSpend / limit) * 100) : 0;
          const cyclePct = c.cycle.totalDays ? Math.min(100, (c.cycle.elapsed / c.cycle.totalDays) * 100) : 0;
          const maxMonth = Math.max(1, ...c.monthly.map((row) => row.amount));
          const splitTotal = Math.max(1, c.categorySplit.reduce((sum, row) => sum + row.amount, 0));
          const dueTone = c.daysToDue <= 3 ? 'over' : c.daysToDue <= 7 ? 'warn' : undefined;
          return (
            <div className="card card-lift overflow-hidden anim" key={c.id} style={{['--d' as string]: `${index * 70}ms`}}>
              <div className="h-1.5 w-full bg-gradient-to-r from-emerald-400 via-emerald-500 to-teal-600" />
              <div className="p-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-200">
                      <CreditCard size={19} />
                    </span>
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Credit card</div>
                      <h2 className="text-lg font-extrabold text-slate-900">{c.cardName}</h2>
                    </div>
                  </div>
                  <span className={bandClass[c.band]}>{bandLabel[c.band]} · {Math.round(c.cycleUtilisation || c.utilisation)}%</span>
                </div>

                <div className="mt-6 text-sm text-slate-500">Spent this month</div>
                <div className="text-3xl font-extrabold tracking-tight text-slate-900">{money(c.monthSpend)}</div>

                <div className="progress mt-4" data-tone={pct >= 80 ? 'over' : pct >= 60 ? 'warn' : undefined}>
                  <span style={{width: mounted ? `${pct}%` : '0%'}} />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                  <span>{money(c.available)} available of {money(limit)}</span>
                  <span className="font-bold text-slate-600">{Math.round(pct)}% used</span>
                </div>

                <div className="mt-4 rounded-xl bg-slate-50 p-3">
                  <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <span>Billing cycle</span>
                    <span className={c.cycle.daysLeft <= 3 ? 'text-rose-600' : 'text-slate-500'}>{c.cycle.daysLeft}d left</span>
                  </div>
                  <div className="mt-1.5 text-[13px] font-semibold text-slate-700">
                    {formatDate(c.cycle.start)} → {formatDate(c.cycle.end)}
                  </div>
                  <div className="progress mt-2">
                    <span style={{width: mounted ? `${cyclePct}%` : '0%'}} />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[12px] text-slate-500">
                    <span>Cycle spend <b className="text-slate-800">{money(c.cycleSpend)}</b></span>
                    <span>Est. bill <b className="text-slate-800">{money(c.projectedBill)}</b></span>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-emerald-50 p-2.5">
                    <div className="flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                      <Gift size={11} /> Rewards
                    </div>
                    <b className="mt-1 block text-[13px] text-emerald-800">{c.rewards !== null ? money(c.rewards) : '—'}</b>
                  </div>
                  <div className="rounded-xl bg-sky-50 p-2.5">
                    <div className="flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider text-sky-600">
                      <Receipt size={11} /> Min. due
                    </div>
                    <b className="mt-1 block text-[13px] text-sky-800">{money(c.minDue)}</b>
                  </div>
                  <div className="rounded-xl bg-rose-50 p-2.5">
                    <div className="flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider text-rose-600">
                      <Percent size={11} /> Interest
                    </div>
                    <b className="mt-1 block text-[13px] text-rose-800">{c.interest !== null ? money(c.interest) : '—'}</b>
                  </div>
                </div>
                {(c.apr !== null || c.rewardsRate !== null) && (
                  <div className="mt-2 text-[11px] text-slate-400">
                    {c.apr !== null && c.interest !== null ? `${c.apr}% p.a. · interest if you roll over the bill` : ''}
                    {c.apr !== null && c.rewardsRate !== null ? ' · ' : ''}
                    {c.rewardsRate !== null ? `${c.rewardsRate}% rewards on this bill` : ''}
                  </div>
                )}

                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl bg-slate-50 p-3 transition hover:bg-emerald-50">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      <CalendarDays size={12} /> Statement
                    </div>
                    <b className="mt-1 block text-slate-800">{formatDate(c.statementDate)}</b>
                    <span className="text-[11px] text-slate-500">in {c.daysToStatement} days</span>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 transition hover:bg-emerald-50" data-tone={dueTone}>
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      <CalendarDays size={12} /> Payment due
                    </div>
                    <b className={`mt-1 block ${dueTone === 'over' ? 'text-rose-700' : 'text-slate-800'}`}>{formatDate(c.dueDate)}</b>
                    <span className={`text-[11px] font-semibold ${dueTone === 'over' ? 'text-rose-600' : 'text-slate-500'}`}>
                      in {c.daysToDue} days
                    </span>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <span>6-month trend</span>
                    <span className="flex items-center gap-1"><TrendingUp size={11} /> {c.transactionCount} txns</span>
                  </div>
                  <div className="mt-2 flex h-16 items-end gap-1.5">
                    {c.monthly.map((row) => (
                      <div key={row.month} className="group flex-1" title={`${row.month}: ${money(row.amount)}`}>
                        <div
                          className="w-full rounded-t-md bg-gradient-to-t from-emerald-500 to-emerald-300 transition-all duration-700 group-hover:from-emerald-600 group-hover:to-emerald-400"
                          style={{height: mounted ? `${Math.max(3, (row.amount / maxMonth) * 56)}px` : '3px'}}
                        />
                        <div className="mt-1 text-center text-[9px] font-bold uppercase text-slate-400">{row.month}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {c.categorySplit.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Where it went</div>
                    {c.categorySplit.map((row) => (
                      <div key={row.name}>
                        <div className="flex items-center justify-between text-[12px]">
                          <span className="flex items-center gap-1.5 font-semibold text-slate-600">
                            <span className="h-2 w-2 rounded-full" style={{background: row.color}} />
                            {row.name}
                          </span>
                          <span className="font-bold text-slate-700">{money(row.amount)}</span>
                        </div>
                        <div className="progress mt-1">
                          <span style={{width: `${(row.amount / splitTotal) * 100}%`, background: row.color}} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <button className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-rose-500 transition hover:text-rose-700" onClick={() => remove(c)}>
                  <Trash2 size={13} /> Delete card
                </button>
              </div>
            </div>
          );
        })}

        <button
          className="anim grid min-h-[260px] place-items-center rounded-[18px] border-2 border-dashed border-emerald-200 bg-emerald-50/40 text-emerald-700 transition hover:-translate-y-1 hover:border-emerald-400 hover:bg-emerald-50"
          style={{['--d' as string]: `${cards.length * 70}ms`}}
          onClick={() => setOpen(true)}
        >
          <span className="flex flex-col items-center gap-2 text-sm font-bold">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-emerald-600 text-white">
              <Plus size={22} strokeWidth={3} />
            </span>
            Add a credit card
          </span>
        </button>
      </div>

      {open && (
        <div className="overlay" onClick={close}>
          <form className="modal max-w-md" onClick={(e) => e.stopPropagation()} onSubmit={save}>
            <div className="modal-head">
              <div className="flex items-center gap-3">
                <span className="icon-tile">
                  <CreditCard size={20} />
                </span>
                <div>
                  <h2 className="text-lg font-extrabold">Add Credit Card</h2>
                  <p className="text-[12.5px] text-emerald-100/80">Limits, due dates, rewards and interest</p>
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

            <div className="grid gap-4 p-6 sm:grid-cols-2">
              {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 sm:col-span-2">{error}</div>}
              <div className="anim sm:col-span-2">
                <label className="label" htmlFor="k-name">Card name *</label>
                <input id="k-name" required className="input" placeholder="e.g. HDFC Regalia" value={form.cardName} onChange={(e) => setForm({...form, cardName: e.target.value})} />
              </div>
              <div className="anim" style={{['--d' as string]: '70ms'}}>
                <label className="label" htmlFor="k-limit">Credit limit *</label>
                <input id="k-limit" required type="number" min="0" step="0.01" className="input" placeholder="100000" value={form.creditLimit} onChange={(e) => setForm({...form, creditLimit: e.target.value})} />
              </div>
              <div className="anim" style={{['--d' as string]: '110ms'}}>
                <label className="label" htmlFor="k-notes">Notes</label>
                <input id="k-notes" className="input" placeholder="Last 4 digits, bank…" value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})} />
              </div>
              <div className="anim" style={{['--d' as string]: '150ms'}}>
                <label className="label" htmlFor="k-stmt">Statement day *</label>
                <input id="k-stmt" required type="number" min="1" max="31" className="input" value={form.statementGenerationDay} onChange={(e) => setForm({...form, statementGenerationDay: e.target.value})} />
              </div>
              <div className="anim" style={{['--d' as string]: '190ms'}}>
                <label className="label" htmlFor="k-due">Due day *</label>
                <input id="k-due" required type="number" min="1" max="31" className="input" value={form.dueDay} onChange={(e) => setForm({...form, dueDay: e.target.value})} />
              </div>
              <div className="anim" style={{['--d' as string]: '230ms'}}>
                <label className="label" htmlFor="k-apr">Interest rate (APR %)</label>
                <input id="k-apr" type="number" min="0" max="100" step="0.01" className="input" placeholder="e.g. 42" value={form.apr} onChange={(e) => setForm({...form, apr: e.target.value})} />
                <span className="mt-1 block text-[11px] text-slate-400">Used to estimate interest on rolled-over bills</span>
              </div>
              <div className="anim" style={{['--d' as string]: '270ms'}}>
                <label className="label" htmlFor="k-rewards">Rewards rate (%)</label>
                <input id="k-rewards" type="number" min="0" max="100" step="0.01" className="input" placeholder="e.g. 1.5" value={form.rewardsRate} onChange={(e) => setForm({...form, rewardsRate: e.target.value})} />
                <span className="mt-1 block text-[11px] text-slate-400">Cashback or points value per rupee spent</span>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50/70 px-6 py-4">
              <button type="button" className="btn btn-ghost" onClick={close}>Cancel</button>
              <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save card'}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
