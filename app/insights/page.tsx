'use client';
import {useCallback, useEffect, useState} from 'react';
import {Header} from '@/components/header';
import {StatCard} from '@/components/stat-card';
import {formatMoney, useUser} from '@/lib/use-user';
import {formatDate} from '@/lib/money';
import {whatIf} from '@/lib/whatif';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  Flame,
  ListOrdered,
  Percent,
  Repeat,
  Sparkles,
  Target,
  TrendingUp,
  Wallet,
} from 'lucide-react';

type Series = {name: string; color: string};
type Daily = {date: string; label: string; amount: number; avg7: number};
type Weekday = {day: string; amount: number};
type Trend = {month: string} & Record<string, number | string>;
type Monthly = {key: string; label: string; spend: number; income: number};
type ForecastRow = {id: string; name: string; color: string; budget: number; spent: number; projected: number; status: string};
type TopExpense = {id: string; description: string; amount: number; date: string; category: string; color: string; method: string};
type Subscription = {
  name: string;
  amount: number;
  occurrences: number;
  lastDate: string;
  nextDue: string;
  gapDays: number;
  overdue: boolean;
  category: string;
  color: string;
};

type MomPair = {current: number; previous: number; pct: number};
type MomRow = {id: string; name: string; color: string; current: number; previous: number; pct: number; delta: number};
type Mom = {spend: MomPair; income: MomPair; savings: MomPair; categories: MomRow[]; cutoff: number};
type Tax = {fy: string; eligible: number; count: number; flagged: number; byCategory: {id: string; name: string; color: string; amount: number}[]};

type Insights = {
  window: {start: string; end: string; months: number};
  totals: {
    spend: number;
    income: number;
    savings: number;
    avgDaily: number;
    count: number;
    biggestDay: {date: string; label: string; amount: number};
    momPct: number;
    forecastTotal: number;
    commitment: number;
    weekdayTop: string;
  };
  daily: Daily[];
  weekday: Weekday[];
  categoryTrend: {series: Series[]; rows: Trend[]};
  monthly: Monthly[];
  forecast: ForecastRow[];
  forecastMeta: {elapsed: number; daysInMonth: number; daysLeft: number};
  subscriptions: unknown[];
  topExpenses: TopExpense[];
  mom: Mom;
  tax: Tax;
};

const statusLabel: Record<string, string> = {
  over: 'Projected overspend',
  watch: 'Getting close',
  'on-track': 'On track',
  'no-budget': 'No budget set',
};

const statusTone: Record<string, string> = {
  over: 'badge badge-income',
  watch: 'badge badge-want',
  'on-track': 'badge badge-need',
  'no-budget': 'badge',
};

export default function InsightsPage() {
  const [months, setMonths] = useState(6);
  const [data, setData] = useState<Insights | null>(null);
  const [subs, setSubs] = useState<{subscriptions: Subscription[]; commitment: number} | null>(null);
  const [cut, setCut] = useState(10);
  const [extra, setExtra] = useState(0);
  const [error, setError] = useState('');
  const user = useUser();
  const symbol = user?.currencySymbol ?? '₹';
  const money = (value: number) => formatMoney(value, symbol);

  const load = useCallback(() => {
    fetch(`/api/analytics/insights?months=${months}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else {
          setError('');
          setData(d);
        }
      })
      .catch(() => setError('Could not load insights'));
  }, [months]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch('/api/analytics/subscriptions')
      .then((r) => r.json())
      .then(setSubs)
      .catch(() => setSubs(null));
  }, []);

  const t = data?.totals;
  const momUp = (t?.momPct ?? 0) > 0;
  const trendColors = (data?.categoryTrend.series ?? []).map((s) => s.color);
  const trendNames = (data?.categoryTrend.series ?? []).map((s) => s.name);
  const forecast = data?.forecast ?? [];
  const projectedTotal = forecast.reduce((sum, row) => sum + row.projected, 0);
  const currentMonth = data?.monthly[data.monthly.length - 1];
  const baselineSpend = currentMonth?.spend ?? 0;
  const baselineIncome = Math.max(user?.monthlyIncome ?? 0, currentMonth?.income ?? 0, baselineSpend);
  const scenario = whatIf({income: baselineIncome, spend: baselineSpend, cutPct: cut, extraSaving: extra});
  const momRows: {label: string; pair: MomPair; upIsGood: boolean}[] = data
    ? [
        {label: 'Spend', pair: data.mom.spend, upIsGood: false},
        {label: 'Income', pair: data.mom.income, upIsGood: true},
        {label: 'Savings', pair: data.mom.savings, upIsGood: true},
      ]
    : [];

  return (
    <>
      <Header
        title="Spending Insights"
        subtitle="Trends, patterns and forecasts across your whole ledger."
        action={
          <div className="seg" role="tablist" aria-label="Analysis window">
            {[3, 6, 12].map((value) => (
              <button
                key={value}
                type="button"
                className="seg-btn"
                data-active={months === value}
                onClick={() => setMonths(value)}
              >
                {value}M
              </button>
            ))}
          </div>
        }
      />

      {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

      <section className="hero p-5 md:p-7 anim">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200/40 bg-white/10 px-3.5 py-1.5 text-[12.5px] font-semibold text-emerald-50">
            <CalendarClock size={14} />
            {data ? `${formatDate(data.window.start)} → ${formatDate(data.window.end)}` : 'Loading window…'}
          </span>
          <span className="text-[12px] text-emerald-100/70">{data ? `${t?.count ?? 0} transactions analysed` : 'Crunching your data…'}</span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <StatCard label="Window Spend" amount={t?.spend ?? 0} symbol={symbol} sub="Across the selected period" icon={<Wallet size={17} />} delay={50} onDark />
          <StatCard label="Average Daily" amount={t?.avgDaily ?? 0} symbol={symbol} sub="Burn rate per day" icon={<Flame size={17} />} delay={110} onDark />
          <StatCard
            label="Vs Last Month"
            text={`${momUp ? '+' : ''}${t?.momPct ?? 0}%`}
            sub="vs same days last month"
            icon={momUp ? <ArrowUpRight size={17} /> : <ArrowDownRight size={17} />}
            delay={170}
            onDark
          />
          <StatCard label="Biggest Day" amount={t?.biggestDay.amount ?? 0} symbol={symbol} sub={t?.biggestDay.label || 'No spending yet'} icon={<TrendingUp size={17} />} delay={230} onDark />
          <StatCard label="Month-End Forecast" amount={t?.forecastTotal ?? 0} symbol={symbol} sub={`Projected across ${forecast.length} categories`} icon={<Target size={17} />} delay={290} onDark />
          <StatCard label="Recurring Monthly" amount={t?.commitment ?? 0} symbol={symbol} sub="Subscriptions & repeats" icon={<Repeat size={17} />} delay={350} onDark />
        </div>
      </section>

      <div className="mt-6 grid gap-5 xl:grid-cols-3">
        <div className="card p-5 xl:col-span-2 anim" style={{['--d' as string]: '120ms'}}>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-slate-900">Daily Spending</h2>
              <p className="text-xs text-slate-500">Every day&apos;s spend with a 7-day moving average</p>
            </div>
            <div className="flex items-center gap-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Daily</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-violet-500" /> 7-day avg</span>
            </div>
          </div>
          <div className="h-72">
            {!data ? (
              <div className="skeleton h-full w-full rounded-2xl" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.daily} margin={{top: 6, right: 8, left: -12, bottom: 0}}>
                  <CartesianGrid strokeDasharray="4 4" stroke="#e6efeb" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="#94a3b8" interval="preserveStartEnd" />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="#94a3b8" width={52} />
                  <Tooltip
                    cursor={{stroke: 'rgba(5,150,105,.35)'}}
                    contentStyle={{borderRadius: 14, border: '1px solid #e3ece8'}}
                    formatter={(value, name) => [money(Number(value)), name === 'avg7' ? '7-day avg' : 'Spent']}
                  />
                  <Line type="monotone" dataKey="amount" name="amount" stroke="#059669" strokeWidth={2} dot={false} animationDuration={900} />
                  <Line type="monotone" dataKey="avg7" name="avg7" stroke="#7c3aed" strokeWidth={2.5} strokeDasharray="5 4" dot={false} animationDuration={1100} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="card p-5 anim" style={{['--d' as string]: '180ms'}}>
          <div className="mb-4">
            <h2 className="font-bold text-slate-900">Weekday Pattern</h2>
            <p className="text-xs text-slate-500">
              You spend most on <b className="text-emerald-600">{t?.weekdayTop ?? '—'}</b>
            </p>
          </div>
          <div className="h-72">
            {!data ? (
              <div className="skeleton h-full w-full rounded-2xl" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.weekday} margin={{top: 6, right: 8, left: -14, bottom: 0}}>
                  <CartesianGrid strokeDasharray="4 4" stroke="#e6efeb" vertical={false} />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={12} stroke="#94a3b8" />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="#94a3b8" width={48} />
                  <Tooltip
                    cursor={{fill: 'rgba(5,150,105,.07)'}}
                    contentStyle={{borderRadius: 14, border: '1px solid #e3ece8'}}
                    formatter={(value) => [money(Number(value)), 'Spent']}
                  />
                  <Bar dataKey="amount" radius={[6, 6, 0, 0]} animationDuration={900}>
                    {data.weekday.map((entry) => (
                      <Cell key={entry.day} fill={entry.amount === Math.max(...data.weekday.map((d) => d.amount)) ? '#059669' : '#a7f3d0'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <div className="card p-5 xl:col-span-2 anim" style={{['--d' as string]: '140ms'}}>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-slate-900">Category Trends</h2>
              <p className="text-xs text-slate-500">Month-by-month split of your top categories</p>
            </div>
            <span className="badge badge-need">{trendNames.length} categories</span>
          </div>
          <div className="h-72">
            {!data ? (
              <div className="skeleton h-full w-full rounded-2xl" />
            ) : data.categoryTrend.rows.length === 0 ? (
              <div className="grid h-full place-items-center text-sm font-semibold text-slate-400">Not enough history yet</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.categoryTrend.rows} margin={{top: 6, right: 8, left: -6, bottom: 0}}>
                  <CartesianGrid strokeDasharray="4 4" stroke="#e6efeb" vertical={false} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} stroke="#94a3b8" />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="#94a3b8" width={52} />
                  <Tooltip
                    cursor={{fill: 'rgba(5,150,105,.07)'}}
                    contentStyle={{borderRadius: 14, border: '1px solid #e3ece8'}}
                    formatter={(value, name) => [money(Number(value)), String(name)]}
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize: 12}} />
                  {trendNames.map((name, index) => (
                    <Bar key={name} dataKey={name} stackId="trend" fill={trendColors[index]} animationDuration={800} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="card p-5 anim" style={{['--d' as string]: '200ms'}}>
          <div className="mb-4">
            <h2 className="font-bold text-slate-900">Spend vs Income</h2>
            <p className="text-xs text-slate-500">Monthly comparison including last month as baseline</p>
          </div>
          <div className="h-72">
            {!data ? (
              <div className="skeleton h-full w-full rounded-2xl" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.monthly} margin={{top: 6, right: 8, left: -14, bottom: 0}}>
                  <CartesianGrid strokeDasharray="4 4" stroke="#e6efeb" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} stroke="#94a3b8" />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="#94a3b8" width={48} />
                  <Tooltip
                    cursor={{fill: 'rgba(5,150,105,.07)'}}
                    contentStyle={{borderRadius: 14, border: '1px solid #e3ece8'}}
                    formatter={(value, name) => [money(Number(value)), name === 'income' ? 'Income' : 'Spent']}
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize: 12}} />
                  <Bar dataKey="income" name="income" fill="#0ea5e9" radius={[5, 5, 0, 0]} animationDuration={850} />
                  <Bar dataKey="spend" name="spend" fill="#059669" radius={[5, 5, 0, 0]} animationDuration={850} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <div className="card p-5 anim" style={{['--d' as string]: '120ms'}} data-testid="mom-block">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-bold text-slate-900">Month vs Month</h2>
              <p className="text-xs text-slate-500">
                {data ? `This month through day ${data.mom.cutoff} vs same days last month` : 'Side-by-side comparison'}
              </p>
            </div>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-sky-100 text-sky-700">
              <CalendarClock size={16} />
            </span>
          </div>

          <div className="space-y-2.5">
            {momRows.map((row) => {
              const good = row.upIsGood ? row.pair.pct >= 0 : row.pair.pct <= 0;
              const up = row.pair.pct > 0;
              return (
                <div key={row.label} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3.5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-bold text-slate-700">{row.label}</div>
                    <div className="text-[11px] text-slate-500">
                      {money(row.pair.current)} now · {money(row.pair.previous)} before
                    </div>
                  </div>
                  <span className={`badge ${good ? 'badge-need' : 'badge-want'}`} data-testid="mom-pct">
                    {up ? '+' : ''}
                    {row.pair.pct}%
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-4">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Biggest movers</div>
            {(data?.mom.categories ?? []).map((row) => (
              <div key={row.id} className="flex items-center gap-2 py-1.5 text-[12.5px]" data-testid="mom-mover">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{background: row.color}} />
                <span className="min-w-0 flex-1 truncate font-semibold text-slate-700">{row.name}</span>
                <span className="text-slate-500">{money(row.current)}</span>
                <span className={`w-20 text-right font-bold ${row.delta > 0 ? 'text-rose-600' : 'text-emerald-600'}`} data-testid="mom-delta">
                  {row.delta > 0 ? '+' : ''}
                  {money(row.delta)}
                </span>
              </div>
            ))}
            {data && data.mom.categories.length === 0 && (
              <p className="text-xs text-slate-400">Nothing to compare yet — log a full month first.</p>
            )}
          </div>
        </div>

        <div className="card p-5 anim" style={{['--d' as string]: '180ms'}} data-testid="whatif">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-bold text-slate-900">What-If Simulator</h2>
              <p className="text-xs text-slate-500">Model small changes on a typical month</p>
            </div>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-fuchsia-100 text-fuchsia-700">
              <Sparkles size={16} />
            </span>
          </div>

          <label className="block">
            <span className="mb-1 flex items-center justify-between text-[12.5px] font-semibold text-slate-600">
              Cut spending by <b className="text-slate-900" data-testid="whatif-cut-value">{cut}%</b>
            </span>
            <input
              type="range"
              min={0}
              max={50}
              step={5}
              value={cut}
              onChange={(e) => setCut(Number(e.target.value))}
              className="w-full accent-emerald-600"
              data-testid="whatif-cut"
            />
          </label>

          <label className="label mt-3">
            Extra saved each month
            <input
              type="number"
              min={0}
              step={500}
              className="input"
              value={extra}
              onChange={(e) => setExtra(Math.max(0, Number(e.target.value) || 0))}
              data-testid="whatif-extra"
            />
          </label>

          <div className="mt-4 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-4 text-white">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-100/80">Projected yearly savings</div>
            <div className="mt-1 text-2xl font-extrabold" data-testid="whatif-result">{money(scenario.yearlySavings)}</div>
            <div className="mt-1 text-[12px] text-emerald-100/80">
              <span data-testid="whatif-monthly">{money(scenario.savingsAfter)}</span> per month ·{' '}
              <span data-testid="whatif-rate">{scenario.savingsRatePct}%</span> of income
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between text-[12.5px]">
            <span className="font-semibold text-slate-500">vs today</span>
            <span className={`font-bold ${scenario.deltaYearly >= 0 ? 'text-emerald-600' : 'text-rose-600'}`} data-testid="whatif-delta">
              {scenario.deltaYearly >= 0 ? '+' : ''}
              {money(scenario.deltaYearly)}/yr
            </span>
          </div>
        </div>

        <div className="card p-5 anim" style={{['--d' as string]: '240ms'}} data-testid="tax-block">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-bold text-slate-900">Tax-Deductible Spending</h2>
              <p className="text-xs text-slate-500">Flagged categories, financial year {data?.tax.fy ?? ''}</p>
            </div>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-100 text-amber-700">
              <Percent size={16} />
            </span>
          </div>

          <div className="rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 p-4 text-white">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-amber-100/80">Eligible this year</div>
            <div className="mt-1 text-2xl font-extrabold" data-testid="tax-eligible">
              {data ? money(data.tax.eligible) : '—'}
            </div>
            <div className="mt-1 text-[12px] text-amber-100/80">
              <span data-testid="tax-count">{data?.tax.count ?? 0}</span> transactions ·{' '}
              <span data-testid="tax-flagged">{data?.tax.flagged ?? 0}</span> flagged categories
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {(data?.tax.byCategory ?? []).map((row) => (
              <div key={row.id} className="flex items-center gap-2 text-[12.5px]" data-testid="tax-row">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{background: row.color}} />
                <span className="min-w-0 flex-1 truncate font-semibold text-slate-700">{row.name}</span>
                <span className="font-bold text-slate-900">{money(row.amount)}</span>
              </div>
            ))}
            {data && data.tax.byCategory.length === 0 && (
              <p className="rounded-xl bg-slate-50 p-4 text-center text-xs text-slate-500">
                Flag categories like Rent, Insurance or ELSS on the Budgets page to track your deductions here.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="card mt-5 overflow-hidden anim" style={{['--d' as string]: '120ms'}}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="font-bold text-slate-900">Month-End Forecast</h2>
            <p className="text-xs text-slate-500">
              {data
                ? `Day ${data.forecastMeta.elapsed} of ${data.forecastMeta.daysInMonth} · ${data.forecastMeta.daysLeft} days left · projecting ${money(projectedTotal)}`
                : 'Burn-rate projection against your budgets'}
            </p>
          </div>
          <span className="badge badge-need">Auto forecast</span>
        </div>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Category</th>
                <th className="text-right">Budget</th>
                <th className="text-right">Spent</th>
                <th className="text-right">Projected</th>
                <th className="text-right">Headroom</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {forecast.map((row, index) => {
                const headroom = row.budget - row.projected;
                return (
                  <tr key={row.id} className="anim" style={{['--d' as string]: `${Math.min(index, 10) * 35}ms`}}>
                    <td>
                      <span className="flex items-center gap-2 font-semibold text-slate-700">
                        <span className="h-2.5 w-2.5 rounded-full" style={{background: row.color}} />
                        {row.name}
                      </span>
                    </td>
                    <td className="text-right text-slate-500">{row.budget ? money(row.budget) : '—'}</td>
                    <td className="text-right font-semibold text-slate-700">{money(row.spent)}</td>
                    <td className="text-right font-bold text-slate-900">{row.projected ? money(row.projected) : '—'}</td>
                    <td className={`text-right font-semibold ${headroom < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {row.budget ? (headroom < 0 ? `-${money(Math.abs(headroom))}` : money(headroom)) : '—'}
                    </td>
                    <td><span className={statusTone[row.status]}>{statusLabel[row.status]}</span></td>
                  </tr>
                );
              })}
              {forecast.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-sm text-slate-400">No categories to forecast yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <div className="card p-5 anim" style={{['--d' as string]: '100ms'}}>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-bold text-slate-900">Recurring Charges</h2>
              <p className="text-xs text-slate-500">Detected from repeated monthly spends</p>
            </div>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-100 text-violet-700">
              <Repeat size={16} />
            </span>
          </div>

          <div className="rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 p-4 text-white">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-violet-100/80">Monthly commitment</div>
            <div className="mt-1 text-2xl font-extrabold">{money(subs?.commitment ?? t?.commitment ?? 0)}</div>
            <div className="mt-1 text-[12px] text-violet-100/80">{subs ? `${subs.subscriptions.length} repeating charges found` : 'Scanning history…'}</div>
          </div>

          <div className="mt-4 space-y-3">
            {(subs?.subscriptions ?? []).slice(0, 6).map((row) => (
              <div key={`${row.name}-${row.nextDue}`} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3 transition hover:border-emerald-200 hover:bg-emerald-50/40">
                <span className="h-9 w-1.5 rounded-full" style={{background: row.color}} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-slate-800">{row.name}</div>
                  <div className="text-[11px] text-slate-500">
                    {row.category} · every {row.gapDays}d · {row.occurrences} hits
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-extrabold text-slate-900">{money(row.amount)}</div>
                  <div className={`text-[11px] font-semibold ${row.overdue ? 'text-rose-600' : 'text-slate-400'}`}>
                    {row.overdue ? 'Overdue ' : 'due '}{formatDate(row.nextDue)}
                  </div>
                </div>
              </div>
            ))}
            {subs && subs.subscriptions.length === 0 && (
              <div className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500">
                No repeating charges detected yet — log a few months of bills and subscriptions.
              </div>
            )}
            {!subs && <div className="skeleton h-24 w-full rounded-2xl" />}
          </div>
        </div>

        <div className="card p-5 xl:col-span-2 anim" style={{['--d' as string]: '160ms'}}>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-bold text-slate-900">Biggest Transactions</h2>
              <p className="text-xs text-slate-500">Largest spends inside this window</p>
            </div>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-100 text-amber-700">
              <ListOrdered size={16} />
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {(data?.topExpenses ?? []).map((row, index) => (
              <div key={row.id} className="flex items-center gap-4 py-3">
                <span className="w-6 text-center text-sm font-extrabold text-slate-300">{index + 1}</span>
                <span className="h-9 w-1.5 rounded-full" style={{background: row.color}} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-slate-800">{row.description}</div>
                  <div className="text-[11px] text-slate-500">{row.category} · {row.method.replace('_', ' ')} · {formatDate(row.date)}</div>
                </div>
                <div className="text-sm font-extrabold text-slate-900">{money(row.amount)}</div>
              </div>
            ))}
            {data && data.topExpenses.length === 0 && (
              <div className="py-8 text-center text-sm text-slate-400">No transactions in this window.</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
