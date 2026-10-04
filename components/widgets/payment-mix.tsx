import {Cell, Pie, PieChart, ResponsiveContainer, Tooltip} from 'recharts';
import {inr} from '@/lib/use-count-up';
import type {PaymentMixRow, TopCategoryRow} from '@/lib/dashboard';

const PALETTE = ['#059669', '#0ea5e9', '#7c3aed', '#f59e0b', '#e11d48', '#64748b'];

export function PaymentMix({rows, symbol}: {rows: PaymentMixRow[]; symbol: string}) {
  const total = rows.reduce((sum, row) => sum + row.amount, 0) || 1;

  return (
    <div className="card p-5 anim" data-testid="payment-mix" style={{['--d' as string]: '180ms'}}>
      <h2 className="font-bold text-slate-900">Payment mix</h2>
      <p className="text-xs text-slate-500">How you paid this month</p>

      {rows.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
          No spending logged this month yet.
        </p>
      ) : (
        <>
          <div className="mt-2 h-44">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={rows}
                  dataKey="amount"
                  nameKey="label"
                  innerRadius={44}
                  outerRadius={70}
                  paddingAngle={3}
                  animationDuration={900}
                >
                  {rows.map((row, i) => (
                    <Cell key={row.method} fill={PALETTE[i % PALETTE.length]} stroke="none" />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{borderRadius: 14, border: '1px solid #e3ece8'}}
                  formatter={(value, name) => [inr(Number(value), symbol), String(name)]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <ul className="mt-2 space-y-2.5">
            {rows.map((row, i) => (
              <li key={row.method} className="flex items-center gap-3 text-[13px]">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{background: PALETTE[i % PALETTE.length]}} />
                <span className="min-w-0 flex-1 truncate font-semibold text-slate-700">{row.label}</span>
                <span className="text-slate-400">{row.count}×</span>
                <span className="w-12 text-right font-bold text-slate-900">
                  {Math.round((row.amount / total) * 100)}%
                </span>
                <span className="w-20 text-right font-bold text-slate-900">{inr(row.amount, symbol)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function TopCategories({rows, symbol}: {rows: TopCategoryRow[]; symbol: string}) {
  const max = rows[0]?.amount || 1;

  return (
    <div className="card p-5 anim" data-testid="top-categories" style={{['--d' as string]: '220ms'}}>
      <h2 className="font-bold text-slate-900">Top categories</h2>
      <p className="text-xs text-slate-500">Where the money went this month</p>

      {rows.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
          Nothing categorised yet.
        </p>
      ) : (
        <ul className="mt-4 space-y-4">
          {rows.map((row) => (
            <li key={row.id}>
              <div className="flex items-center justify-between gap-3 text-[13px]">
                <span className="flex min-w-0 items-center gap-2 font-semibold text-slate-700">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{background: row.color}} />
                  <span className="truncate">{row.name}</span>
                </span>
                <span className="font-bold text-slate-900">{inr(row.amount, symbol)}</span>
              </div>
              <div className="progress mt-2">
                <span style={{width: `${(row.amount / max) * 100}%`, background: row.color}} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
