import {inr} from '@/lib/use-count-up';
import type {BudgetBlock} from '@/lib/dashboard';

const R = 58;
const CIRC = 2 * Math.PI * R;

const tone: Record<BudgetBlock['status'], {ring: string; badge: string; label: string; text: string}> = {
  'on-track': {ring: '#059669', badge: 'badge badge-need', label: 'On track', text: 'text-emerald-700'},
  watch: {ring: '#f59e0b', badge: 'badge', label: 'Watch it', text: 'text-amber-600'},
  over: {ring: '#e11d48', badge: 'badge badge-want', label: 'Over budget', text: 'text-rose-600'},
  'no-budget': {ring: '#94a3b8', badge: 'badge', label: 'No budgets', text: 'text-slate-500'},
};

export function BudgetRing({budget, symbol}: {budget: BudgetBlock; symbol: string}) {
  const t = tone[budget.status];
  const dash = Math.min(100, budget.pct);

  return (
    <div className="card p-5 anim" data-testid="budget-ring" style={{['--d' as string]: '60ms'}}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-slate-900">Safe to spend</h2>
          <p className="text-xs text-slate-500">
            {budget.daysLeft} days left in this month
          </p>
        </div>
        <span className={t.badge}>{t.label}</span>
      </div>

      <div className="flex flex-col items-center gap-5 sm:flex-row">
        <div className="relative shrink-0">
          <svg width="150" height="150" viewBox="0 0 150 150" role="img" aria-label={`${budget.pct}% of budget spent`}>
            <circle cx="75" cy="75" r={R} fill="none" stroke="#eef4f1" strokeWidth="14" />
            <circle
              cx="75"
              cy="75"
              r={R}
              fill="none"
              stroke={t.ring}
              strokeWidth="14"
              strokeLinecap="round"
              strokeDasharray={`${(dash / 100) * CIRC} ${CIRC}`}
              transform="rotate(-90 75 75)"
              style={{transition: 'stroke-dasharray 700ms ease'}}
            />
            <text x="75" y="70" textAnchor="middle" className="fill-slate-900 text-[26px] font-extrabold">
              {Math.round(budget.pct)}%
            </text>
            <text x="75" y="92" textAnchor="middle" className="fill-slate-500 text-[11px] font-semibold">
              of budget used
            </text>
          </svg>
        </div>

        <div className="w-full min-w-0 flex-1">
          <div className={`rounded-2xl bg-slate-50 p-4 ${t.text}`}>
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] opacity-80">You can spend</div>
            <div className="mt-1 text-[30px] font-extrabold leading-none tracking-tight text-slate-900">
              {inr(budget.remaining, symbol)}
            </div>
            <div className="mt-1.5 text-[12px] font-semibold text-slate-500">
              {budget.daysLeft > 0 ? `${inr(budget.perDay, symbol)} per day for ${budget.daysLeft} days` : 'Budget period ends today'}
            </div>
          </div>

          <dl className="mt-3 space-y-2 text-[13px]">
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">Monthly budget</dt>
              <dd className="font-bold text-slate-900">{inr(budget.budget, symbol)}</dd>
            </div>
            {budget.rollover > 0 && (
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Rolled over</dt>
                <dd className="font-bold text-emerald-600">+{inr(budget.rollover, symbol)}</dd>
              </div>
            )}
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">Spent so far</dt>
              <dd className="font-bold text-slate-900">{inr(budget.spent, symbol)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">Projected this month</dt>
              <dd className={`font-bold ${budget.projected > budget.budget ? 'text-rose-600' : 'text-slate-900'}`}>
                {inr(budget.projected, symbol)}
              </dd>
            </div>
          </dl>

          <div className="progress mt-3" data-tone={budget.status === 'over' ? 'over' : budget.status === 'watch' ? 'warn' : undefined}>
            <span style={{width: `${Math.min(100, budget.pct)}%`, background: t.ring}} />
          </div>
        </div>
      </div>
    </div>
  );
}
