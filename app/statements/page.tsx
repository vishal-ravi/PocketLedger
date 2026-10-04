'use client';
import {useCallback, useEffect, useState} from 'react';
import {Header} from '@/components/header';
import {formatMoney, useUser} from '@/lib/use-user';
import {currentMonth, shiftMonth} from '@/lib/statements';
import {ChevronLeft, ChevronRight, Printer} from 'lucide-react';

type CategoryLine = {name: string; amount: number; count: number};

type Transaction = {
  id: string;
  date: string;
  description: string;
  category: string | null;
  color: string | null;
  amount: number;
  type: string;
  paymentMethod: string;
};

type Statement = {
  month: string;
  label: string;
  range: {from: string; to: string};
  scope: 'all' | 'card';
  card: {id: string; cardName: string; statementGenerationDay: number; dueDay: number} | null;
  income: number;
  spent: number;
  net: number;
  count: number;
  byCategory: CategoryLine[];
  transactions: Transaction[];
  truncated: boolean;
};

type Card = {id: string; cardName: string};

const methodLabel = (method: string) => method.replace(/_/g, ' ').toLowerCase();

export default function StatementsPage() {
  const user = useUser();
  const symbol = user?.currencySymbol ?? '₹';
  const money = (value: number) => formatMoney(value, symbol);

  const [month, setMonth] = useState(() => currentMonth());
  const [scope, setScope] = useState('all');
  const [cards, setCards] = useState<Card[]>([]);
  const [data, setData] = useState<Statement | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    const params = new URLSearchParams({month});
    if (scope !== 'all') params.set('cardId', scope);
    fetch(`/api/statements?${params}`)
      .then((res) => res.json())
      .then((body) => {
        if (body.error) {
          setError(body.error);
          setData(null);
        } else {
          setError('');
          setData(body);
        }
      })
      .catch(() => setError('Could not load the statement'));
  }, [month, scope]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch('/api/credit-cards')
      .then((res) => res.json())
      .then((body) => setCards(body.cards || []))
      .catch(() => setCards([]));
  }, []);

  const maxCategory = data && data.byCategory.length > 0 ? data.byCategory[0].amount : 0;

  return (
    <>
      <Header
        title="Statements"
        subtitle="A printable, month-by-month summary of everything you earned, spent and owed."
        action={
          <button className="btn btn-primary" type="button" onClick={() => window.print()} data-testid="stmt-print">
            <Printer size={16} strokeWidth={3} />
            Print statement
          </button>
        }
      />

      <div className="card mb-5 flex flex-wrap items-end gap-4 p-5 anim">
        <div>
          <label className="label" htmlFor="stmt-month">
            Month
          </label>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="btn btn-soft h-10 w-10 p-0"
              aria-label="Previous month"
              data-testid="stmt-prev"
              onClick={() => setMonth((value) => shiftMonth(value, -1))}
            >
              <ChevronLeft size={16} />
            </button>
            <input
              id="stmt-month"
              type="month"
              className="input w-44"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              data-testid="stmt-month"
            />
            <button
              type="button"
              className="btn btn-soft h-10 w-10 p-0"
              aria-label="Next month"
              data-testid="stmt-next"
              onClick={() => setMonth((value) => shiftMonth(value, 1))}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        <div className="min-w-52">
          <label className="label" htmlFor="stmt-scope">
            Statement for
          </label>
          <select
            id="stmt-scope"
            className="input"
            value={scope}
            onChange={(event) => setScope(event.target.value)}
            data-testid="stmt-scope"
          >
            <option value="all">All accounts</option>
            {cards.map((card) => (
              <option key={card.id} value={card.id}>
                {card.cardName}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-600" data-testid="stmt-error">
            {error}
          </p>
        )}
      </div>

      {data && (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2 text-[13px] font-semibold text-slate-500 anim">
            <span data-testid="stmt-title">
              {data.label}
              {data.card ? ` · ${data.card.cardName}` : ''}
            </span>
            <span data-testid="stmt-range">
              {data.range.from} – {data.range.to}
            </span>
          </div>

          <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card p-5 anim" style={{['--d' as string]: '60ms'}}>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Income</p>
              <p className="mt-1 text-2xl font-extrabold text-emerald-600" data-testid="stmt-income">
                {money(data.income)}
              </p>
            </div>
            <div className="card p-5 anim" style={{['--d' as string]: '90ms'}}>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Spent</p>
              <p className="mt-1 text-2xl font-extrabold text-slate-900" data-testid="stmt-spent">
                {money(data.spent)}
              </p>
            </div>
            <div className="card p-5 anim" style={{['--d' as string]: '120ms'}}>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Net saved</p>
              <p className={`mt-1 text-2xl font-extrabold ${data.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`} data-testid="stmt-net">
                {money(data.net)}
              </p>
            </div>
            <div className="card p-5 anim" style={{['--d' as string]: '150ms'}}>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Transactions</p>
              <p className="mt-1 text-2xl font-extrabold text-slate-900" data-testid="stmt-count">
                {data.count}
              </p>
            </div>
          </div>

          {data.byCategory.length > 0 && (
            <div className="card mb-5 p-5 anim" style={{['--d' as string]: '180ms'}}>
              <h2 className="font-bold text-slate-900">Where the money went</h2>
              <ul className="mt-3 grid gap-2.5" data-testid="stmt-cats">
                {data.byCategory.map((line) => (
                  <li key={line.name} data-testid="stmt-cat-row">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-semibold text-slate-700">{line.name}</span>
                      <span className="font-bold text-slate-900">{money(line.amount)}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                      <div
                        className="h-1.5 rounded-full bg-emerald-500"
                        style={{width: `${maxCategory > 0 ? Math.max(3, Math.round((line.amount / maxCategory) * 100)) : 0}%`}}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card overflow-x-auto p-5 anim" style={{['--d' as string]: '210ms'}}>
            <h2 className="font-bold text-slate-900">Transactions</h2>
            {data.transactions.length === 0 ? (
              <p className="mt-3 rounded-xl bg-slate-50 p-4 text-sm font-semibold text-slate-500" data-testid="stmt-empty">
                No transactions recorded in {data.label}.
              </p>
            ) : (
              <>
                <table className="table mt-3" data-testid="stmt-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th className="hidden sm:table-cell">Category</th>
                      <th className="hidden md:table-cell">Method</th>
                      <th className="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.transactions.map((row) => (
                      <tr key={row.id} data-testid="stmt-row">
                        <td className="whitespace-nowrap text-slate-500">{row.date}</td>
                        <td className="font-semibold text-slate-800">{row.description}</td>
                        <td className="hidden sm:table-cell">
                          {row.category ? (
                            <span className="inline-flex items-center gap-1.5 text-slate-600">
                              <span className="h-2 w-2 rounded-full" style={{background: row.color || '#94a3b8'}} />
                              {row.category}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="hidden text-slate-500 md:table-cell">{methodLabel(row.paymentMethod)}</td>
                        <td
                          className={`text-right font-bold ${row.type === 'INCOME' ? 'text-emerald-600' : 'text-slate-900'}`}
                        >
                          {row.type === 'INCOME' ? '+' : ''}
                          {money(row.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.truncated && (
                  <p className="mt-3 text-[13px] font-semibold text-slate-500" data-testid="stmt-truncated">
                    Showing the first {data.transactions.length} transactions — narrow the month or filter the Daily Log for the rest.
                  </p>
                )}
              </>
            )}
          </div>
        </>
      )}

      {!data && !error && (
        <div className="card p-6 text-sm text-slate-500" data-testid="stmt-loading">
          Loading the statement…
        </div>
      )}
    </>
  );
}
