'use client';
import {useCallback, useEffect, useState} from 'react';
import {Header} from '@/components/header';
import {StatCard} from '@/components/stat-card';
import {inr} from '@/lib/use-count-up';
import {useUser} from '@/lib/use-user';
import {computeEmi} from '@/lib/loans';
import type {LoanDto} from '@/lib/loans';
import {CalendarClock, ChevronDown, Landmark, Plus, Receipt, Trash2} from 'lucide-react';

type InstallmentRow = {
  id: string;
  number: number;
  dueDate: string;
  amount: number;
  status: 'DUE' | 'PAID';
  paidDate: string | null;
  expenseId: string | null;
};

const emptyForm = {
  lenderName: '',
  principal: '',
  annualRate: '',
  tenureMonths: '',
  startDate: '',
  emiAmount: '',
  paymentMethod: 'UPI',
  creditCardId: '',
  notes: '',
};

type Card = {id: string; cardName: string};

const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', {day: 'numeric', month: 'short', year: 'numeric'});

const countdown = (days: number) =>
  days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'due today' : `in ${days}d`;

export default function Loans() {
  const [loans, setLoans] = useState<LoanDto[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({...emptyForm});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<Record<string, InstallmentRow[]>>({});
  const [paying, setPaying] = useState<string | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const user = useUser();
  const symbol = user?.currencySymbol ?? '₹';

  const load = useCallback(() => {
    fetch('/api/loans')
      .then((r) => r.json())
      .then((d) => setLoans(d.loans || []))
      .catch(() => setLoans([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch('/api/credit-cards')
      .then((r) => r.json())
      .then((d) => setCards(d.cards || []))
      .catch(() => setCards([]));
  }, []);

  function setMethod(value: string) {
    setForm((current) => {
      if (value !== 'CREDIT_CARD') return {...current, paymentMethod: value, creditCardId: ''};
      const picked = current.creditCardId || (cards.length === 1 ? cards[0].id : '');
      return {...current, paymentMethod: value, creditCardId: picked};
    });
  }

  const totals = loans.reduce(
    (acc, loan) => ({
      outstanding: acc.outstanding + loan.outstanding,
      monthly: acc.monthly + (loan.nextDue?.amount ?? 0),
      paid: acc.paid + loan.paidAmount,
      overdue: acc.overdue + loan.overdueCount,
    }),
    {outstanding: 0, monthly: 0, paid: 0, overdue: 0},
  );

  const preview =
    Number(form.principal) > 0 && Number(form.tenureMonths) > 0
      ? computeEmi(Number(form.principal), Number(form.annualRate || 0), Number(form.tenureMonths))
      : 0;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/loans', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          lenderName: form.lenderName.trim(),
          principal: Number(form.principal),
          annualRate: Number(form.annualRate || 0),
          tenureMonths: Number(form.tenureMonths),
          startDate: form.startDate,
          emiAmount: form.emiAmount ? Number(form.emiAmount) : undefined,
          paymentMethod: form.paymentMethod,
          creditCardId: form.paymentMethod === 'CREDIT_CARD' && form.creditCardId ? form.creditCardId : null,
          notes: form.notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not save the loan');
        return;
      }
      setForm({...emptyForm});
      setOpen(false);
      load();
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
  }

  async function toggleSchedule(loan: LoanDto) {
    if (expanded === loan.id) {
      setExpanded(null);
      return;
    }
    if (!schedule[loan.id]) {
      const data = await fetch(`/api/loans/${loan.id}`)
        .then((r) => r.json())
        .catch(() => null);
      if (data?.installments) setSchedule((prev) => ({...prev, [loan.id]: data.installments}));
    }
    setExpanded(loan.id);
  }

  async function pay(loan: LoanDto, installmentId: string) {
    setPaying(installmentId);
    try {
      const res = await fetch(`/api/loans/${loan.id}/pay`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({installmentId}),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not record the EMI payment');
        return;
      }
      setLoans((prev) => prev.map((row) => (row.id === loan.id ? data.loan : row)));
      setSchedule((prev) => ({
        ...prev,
        [loan.id]: (prev[loan.id] || []).map((row) =>
          row.id === installmentId
            ? {...row, status: 'PAID', paidDate: new Date().toISOString().slice(0, 10), expenseId: data.expenseId}
            : row,
        ),
      }));
      setError('');
    } finally {
      setPaying(null);
    }
  }

  async function remove(loan: LoanDto) {
    if (!window.confirm(`Delete the "${loan.lenderName}" loan and its schedule?`)) return;
    await fetch(`/api/loans/${loan.id}`, {method: 'DELETE'}).then(() => {
      setExpanded(null);
      load();
    });
  }

  return (
    <>
      <Header
        title="Loans & EMIs"
        subtitle="Track every instalment, pay an EMI and watch the balance fall."
        action={
          <button className="btn btn-primary" type="button" onClick={() => setOpen((value) => !value)} data-testid="loan-toggle">
            <Plus size={16} /> {open ? 'Cancel' : 'Add loan'}
          </button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Outstanding" amount={totals.outstanding} symbol={symbol} sub="Across all loans" icon={<Landmark size={17} />} delay={60} />
        <StatCard label="Next EMIs" amount={totals.monthly} symbol={symbol} sub="Due next per loan" icon={<CalendarClock size={17} />} tone="sky" delay={120} />
        <StatCard label="Paid so far" amount={totals.paid} symbol={symbol} sub="Repayments recorded" icon={<Receipt size={17} />} tone="violet" delay={180} />
        <StatCard label="Overdue EMIs" text={String(totals.overdue)} sub="Past their due date" icon={<CalendarClock size={17} />} tone={totals.overdue ? 'rose' : 'amber'} delay={240} />
      </div>

      {open && (
        <form onSubmit={save} className="card mt-5 p-5 anim" data-testid="loan-form">
          <h2 className="font-bold text-slate-900">New loan</h2>
          <p className="text-xs text-slate-500">The EMI schedule is generated automatically from these numbers.</p>

          <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            <label className="label">
              Lender
              <input
                className="input"
                placeholder="HDFC / Bajaj / friend"
                value={form.lenderName}
                onChange={(e) => setForm({...form, lenderName: e.target.value})}
                data-testid="loan-lender"
              />
            </label>
            <label className="label">
              Principal
              <input
                className="input"
                inputMode="decimal"
                placeholder="480000"
                value={form.principal}
                onChange={(e) => setForm({...form, principal: e.target.value})}
                data-testid="loan-principal"
              />
            </label>
            <label className="label">
              Interest (% p.a.)
              <input
                className="input"
                inputMode="decimal"
                placeholder="11.5"
                value={form.annualRate}
                onChange={(e) => setForm({...form, annualRate: e.target.value})}
                data-testid="loan-rate"
              />
            </label>
            <label className="label">
              Tenure (months)
              <input
                className="input"
                inputMode="numeric"
                placeholder="36"
                value={form.tenureMonths}
                onChange={(e) => setForm({...form, tenureMonths: e.target.value})}
                data-testid="loan-tenure"
              />
            </label>
            <label className="label">
              Start date
              <input
                className="input"
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({...form, startDate: e.target.value})}
                data-testid="loan-start"
              />
            </label>
            <label className="label">
              Paid via
              <select
                className="input"
                value={form.paymentMethod}
                onChange={(e) => setMethod(e.target.value)}
                data-testid="loan-method"
              >
                <option value="UPI">UPI</option>
                <option value="BANK_TRANSFER">Bank transfer</option>
                <option value="DEBIT_CARD">Debit card</option>
                <option value="CREDIT_CARD">Credit card</option>
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
                  data-testid="loan-card"
                >
                  <option value="">Select a credit card…</option>
                  {cards.map((c) => (
                    <option key={c.id} value={c.id}>{c.cardName}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="label">
              EMI (auto)
              <input
                className="input"
                inputMode="decimal"
                placeholder={preview ? String(Math.round(preview)) : 'calculated for you'}
                value={form.emiAmount}
                onChange={(e) => setForm({...form, emiAmount: e.target.value})}
                data-testid="loan-emi"
              />
            </label>
            <label className="label sm:col-span-2">
              Notes
              <input
                className="input"
                placeholder="optional"
                value={form.notes}
                onChange={(e) => setForm({...form, notes: e.target.value})}
                data-testid="loan-notes"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button className="btn btn-primary" type="submit" disabled={busy} data-testid="loan-save">
              {busy ? 'Saving…' : 'Create loan'}
            </button>
            {preview > 0 && (
              <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-[12.5px] font-bold text-emerald-700" data-testid="loan-preview">
                EMI {inr(preview, symbol)} × {form.tenureMonths} months
              </span>
            )}
            {error && (
              <span className="text-[12.5px] font-semibold text-rose-600" data-testid="loan-error">
                {error}
              </span>
            )}
          </div>
        </form>
      )}

      {error && !open && (
        <p className="mt-4 text-[13px] font-semibold text-rose-600" data-testid="loan-error">
          {error}
        </p>
      )}

      {loans.length === 0 ? (
        <div className="card mt-5 p-12 text-center anim">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
            <Landmark size={22} />
          </div>
          <p className="font-semibold text-slate-700">No loans tracked yet</p>
          <p className="mt-1 text-sm text-slate-500">Add a loan to generate its EMI schedule and start paying it down.</p>
        </div>
      ) : (
        <div className="mt-5 grid gap-5 xl:grid-cols-2" data-testid="loan-list">
          {loans.map((loan, index) => {
            return (
              <div key={loan.id} className="card p-5 anim" data-testid="loan-card" style={{['--d' as string]: `${index * 70}ms`}}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="icon-tile-soft text-emerald-700">
                      <Landmark size={17} />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[15px] font-bold text-slate-900">{loan.lenderName}</div>
                      <div className="text-[11.5px] text-slate-500">
                        {loan.annualRate}% p.a. · {loan.tenureMonths} months · {loan.paymentMethod.replace('_', ' ').toLowerCase()}
                        {loan.creditCardId && ` · ${cards.find((c) => c.id === loan.creditCardId)?.cardName ?? 'card'}`}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`delete ${loan.lenderName}`}
                    onClick={() => remove(loan)}
                    className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                    data-testid="loan-delete"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl bg-slate-50 p-3">
                    <div className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400">EMI</div>
                    <div className="mt-1 text-[16px] font-extrabold text-slate-900">{inr(loan.emiAmount, symbol)}</div>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <div className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400">Outstanding</div>
                    <div className="mt-1 text-[16px] font-extrabold text-slate-900">{inr(loan.outstanding, symbol)}</div>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <div className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400">Paid</div>
                    <div className="mt-1 text-[16px] font-extrabold text-emerald-700">{inr(loan.paidAmount, symbol)}</div>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <div className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400">Left</div>
                    <div className="mt-1 text-[16px] font-extrabold text-slate-900">
                      {loan.paidCount}/{loan.tenureMonths}
                    </div>
                  </div>
                </div>

                <div className="progress mt-4">
                  <span style={{width: `${loan.progress}%`}} />
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-slate-500">
                  <span className="font-bold text-emerald-700">{Math.round(loan.progress)}% repaid</span>
                  <span>
                    {loan.nextDue
                      ? `Next: ${loan.nextDue.number} on ${fmtDay(loan.nextDue.dueDate)} (${countdown(loan.nextDue.daysToDue)})`
                      : 'All instalments cleared'}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {loan.nextDue && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={paying === loan.nextDue.id}
                      onClick={() => pay(loan, loan.nextDue!.id)}
                      data-testid="loan-pay"
                    >
                      {paying === loan.nextDue.id ? 'Recording…' : `Pay ${inr(loan.nextDue.amount, symbol)} EMI`}
                    </button>
                  )}
                  <button type="button" className="btn btn-soft" onClick={() => toggleSchedule(loan)} data-testid="loan-schedule-toggle">
                    Schedule <ChevronDown size={15} />
                  </button>
                  {loan.overdueCount > 0 && (
                    <span className="badge badge-want">{loan.overdueCount} overdue</span>
                  )}
                </div>

                {expanded === loan.id && (
                  <div className="mt-4 overflow-x-auto anim-fade" data-testid="loan-schedule">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Due date</th>
                          <th>Amount</th>
                          <th>Status</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {(schedule[loan.id] || []).map((row) => (
                          <tr key={row.id}>
                            <td className="font-semibold text-slate-600">{row.number}</td>
                            <td>{fmtDay(row.dueDate)}</td>
                            <td className="font-bold text-slate-900">{inr(row.amount, symbol)}</td>
                            <td>
                              <span className={row.status === 'PAID' ? 'badge badge-need' : 'badge'}>
                                {row.status === 'PAID' ? `Paid ${row.paidDate ? fmtDay(row.paidDate) : ''}` : 'Due'}
                              </span>
                            </td>
                            <td className="text-right">
                              {row.status === 'DUE' ? (
                                <button
                                  type="button"
                                  className="btn btn-soft"
                                  disabled={paying === row.id}
                                  onClick={() => pay(loan, row.id)}
                                  data-testid="loan-pay-row"
                                >
                                  Pay
                                </button>
                              ) : (
                                <span className="text-[11.5px] text-slate-400">logged</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

    </>
  );
}
