import {AlertTriangle, Flame, Gauge, TrendingDown, TrendingUp} from 'lucide-react';
import {inr} from '@/lib/use-count-up';
import type {AnomalyBlock, StreakBlock} from '@/lib/dashboard';

function Tile({icon, label, value, sub}: {icon: React.ReactNode; label: string; value: string; sub: string}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-3.5">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">
        <span className="grid h-6 w-6 place-items-center rounded-lg bg-emerald-50 text-emerald-600">{icon}</span>
        {label}
      </div>
      <div className="mt-2 text-[22px] font-extrabold leading-none text-slate-900">{value}</div>
      <div className="mt-1.5 text-[11.5px] text-slate-500">{sub}</div>
    </div>
  );
}

export function PaceAlert({
  anomaly,
  streaks,
  symbol,
}: {
  anomaly: AnomalyBlock;
  streaks: StreakBlock;
  symbol: string;
}) {
  const bad = anomaly.flagged;
  return (
    <div className="card p-5 anim" data-testid="pace-alert" style={{['--d' as string]: '100ms'}}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-slate-900">Pace &amp; habits</h2>
          <p className="text-xs text-slate-500">How today compares with your usual rhythm</p>
        </div>
        <span className={bad ? 'badge badge-want' : 'badge badge-need'}>{bad ? 'Heads up' : 'Looking good'}</span>
      </div>

      <div
        data-testid="anomaly-banner"
        className={`flex items-start gap-3 rounded-2xl border p-4 ${
          bad ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-100 bg-emerald-50/70 text-emerald-800'
        }`}
      >
        <span className={`mt-0.5 shrink-0 ${bad ? 'text-amber-500' : 'text-emerald-600'}`}>
          {bad ? <AlertTriangle size={18} /> : anomaly.pacePct >= 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
        </span>
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold leading-snug">{anomaly.message}</p>
          <p className="mt-1 text-[11.5px] opacity-80">
            Expected {inr(anomaly.expected, symbol)} · actual {inr(anomaly.actual, symbol)} this month
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Tile
          icon={<Flame size={13} />}
          label="No-spend"
          value={`${streaks.noSpendDays}d`}
          sub="Consecutive days with zero spend"
        />
        <Tile
          icon={<Gauge size={13} />}
          label="Under budget"
          value={`${streaks.underBudgetDays}d`}
          sub="Days inside your daily budget cap"
        />
        <Tile
          icon={<TrendingUp size={13} />}
          label="Days logged"
          value={`${streaks.daysLogged}/${streaks.daysInMonth}`}
          sub={`${streaks.daysLeft} days left this month`}
        />
      </div>
    </div>
  );
}
