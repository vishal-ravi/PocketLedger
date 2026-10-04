'use client';
import {useCallback, useEffect, useState} from 'react';
import Link from 'next/link';
import {Header} from '@/components/header';
import {StatCard} from '@/components/stat-card';
import {BudgetRing} from '@/components/widgets/budget-ring';
import {PaceAlert} from '@/components/widgets/pace-alert';
import {PaymentMix, TopCategories} from '@/components/widgets/payment-mix';
import {Recent} from '@/components/widgets/recent';
import {Upcoming} from '@/components/widgets/upcoming';
import {Goals} from '@/components/widgets/goals';
import {NetWorthCard} from '@/components/widgets/net-worth';
import {inr} from '@/lib/use-count-up';
import {useUser} from '@/lib/use-user';
import type {DashboardData, Summary} from '@/lib/dashboard';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {Wallet, PiggyBank, TrendingUp, Percent, CalendarDays, Sparkles} from 'lucide-react';

type CashflowRow = {month: string; income: number; expenses: number; savings: number};

const empty: Summary = {
  income: 0,
  expenses: 0,
  savings: 0,
  savingsRate: 0,
  dailyAverage: 0,
  needs: 0,
  wants: 0,
  topCategory: 'None',
};

export default function Dashboard() {
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [cashflow, setCashflow] = useState<CashflowRow[]>([]);
  const user = useUser();
  const symbol = user?.currencySymbol ?? '₹';
  const summary = dash?.summary ?? empty;
  const x = summary;
  const period = new Date().toLocaleString('en-IN', {month: 'long', year: 'numeric'});
  const splitTotal = x.needs + x.wants || 1;
  const donut = [
    {name: 'Needs', value: x.needs, color: '#059669'},
    {name: 'Wants', value: x.wants, color: '#7c3aed'},
  ];

  const loadDash = useCallback(() => {
    fetch('/api/analytics/dashboard')
      .then((r) => r.json())
      .then((d) => setDash(d))
      .catch(() => setDash(null));
  }, []);

  useEffect(() => {
    loadDash();
    fetch('/api/analytics/cashflow')
      .then((r) => r.json())
      .then((d) => setCashflow(d.months || []))
      .catch(() => setCashflow([]));
  }, [loadDash]);

  return (
    <>
      <Header
        title="Financial Overview"
        subtitle="A clear view of your spending, budgets and savings."
        action={
          <>
            <Link href="/expenses?new=income" className="btn btn-soft" data-testid="hero-add-income">
              + Add income
            </Link>
            <Link href="/expenses?new=1" className="btn btn-primary">
              + Add expense
            </Link>
          </>
        }
      />

      <section className="hero p-5 md:p-7 anim">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200/40 bg-white/10 px-3.5 py-1.5 text-[12.5px] font-semibold text-emerald-50">
            <CalendarDays size={14} />
            {period} (Current Month)
          </div>
          <span className="text-[12px] text-emerald-100/70">
            {dash ? 'Live from your ledger' : 'Loading your ledger…'}
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <StatCard label="Total Income" amount={x.income} symbol={symbol} sub="This month" icon={<Wallet size={17} />} delay={60} onDark />
          <StatCard label="Period Spending" amount={x.expenses} symbol={symbol} sub="Across all categories" icon={<TrendingUp size={17} />} delay={120} onDark />
          <StatCard label="Net Savings" amount={x.savings} symbol={symbol} sub="Income minus expenses" icon={<PiggyBank size={17} />} delay={180} onDark />
          <StatCard label="Savings Rate" text={`${Math.round(x.savingsRate)}%`} sub="Of monthly income" icon={<Percent size={17} />} delay={240} onDark />
          <StatCard label="Daily Average" amount={x.dailyAverage} symbol={symbol} sub="Across logged days" icon={<CalendarDays size={17} />} delay={300} onDark />
          <StatCard label="Top Category" text={x.topCategory} sub="Highest spend this month" icon={<Sparkles size={17} />} delay={360} onDark />
        </div>
      </section>

      <div className="mt-6 grid gap-5 xl:grid-cols-3">
        <div className="xl:col-span-1">
          {dash ? (
            <BudgetRing budget={dash.budget} symbol={symbol} />
          ) : (
            <div className="skeleton h-[360px] rounded-3xl" />
          )}
        </div>

        <div className="card p-5 xl:col-span-2 anim" style={{['--d' as string]: '120ms'}}>
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-slate-900">Monthly Cashflow</h2>
              <p className="text-xs text-slate-500">Income, spending and savings over the last 6 months</p>
            </div>
            <span className="badge badge-need">6 months</span>
          </div>
          <div className="h-72">
            {cashflow.length === 0 ? (
              <div className="skeleton h-full w-full rounded-2xl" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cashflow} barGap={4}>
                  <CartesianGrid strokeDasharray="4 4" stroke="#e6efeb" vertical={false} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} stroke="#94a3b8" />
                  <YAxis tickLine={false} axisLine={false} fontSize={12} stroke="#94a3b8" width={44} />
                  <Tooltip
                    cursor={{fill: 'rgba(5,150,105,.07)'}}
                    contentStyle={{borderRadius: 14, border: '1px solid #e3ece8', boxShadow: '0 18px 40px -24px rgba(6,78,59,.5)'}}
                  />
                  <Legend iconType="circle" iconSize={9} />
                  <Bar dataKey="income" name="Income" fill="#059669" radius={[6, 6, 0, 0]} animationDuration={900} />
                  <Bar dataKey="expenses" name="Expenses" fill="#0ea5e9" radius={[6, 6, 0, 0]} animationDuration={900} />
                  <Bar dataKey="savings" name="Savings" fill="#7c3aed" radius={[6, 6, 0, 0]} animationDuration={900} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <div className="xl:col-span-1">
          {dash ? (
            <PaceAlert anomaly={dash.anomaly} streaks={dash.streaks} symbol={symbol} />
          ) : (
            <div className="skeleton h-[340px] rounded-3xl" />
          )}
        </div>

        <div className="card p-5 anim" style={{['--d' as string]: '220ms'}}>
          <h2 className="font-bold text-slate-900">Needs vs Wants</h2>
          <p className="text-xs text-slate-500">Where this month&apos;s money actually went</p>

          <div className="mt-3 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={donut} dataKey="value" nameKey="name" innerRadius={58} outerRadius={86} paddingAngle={4} animationDuration={900}>
                  {donut.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} stroke="none" />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{borderRadius: 14, border: '1px solid #e3ece8'}}
                  formatter={(value, name) => [inr(Number(value), symbol), String(name)]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {x.needs + x.wants === 0 && (
            <p className="-mt-14 text-center text-xs font-semibold text-slate-400">No classified spending yet</p>
          )}

          <div className="mt-2 space-y-3">
            <div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 font-semibold text-slate-700">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" /> Needs
                </span>
                <span className="font-bold text-slate-900">{inr(x.needs, symbol)}</span>
              </div>
              <div className="progress mt-2">
                <span style={{width: `${(x.needs / splitTotal) * 100}%`}} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 font-semibold text-slate-700">
                  <span className="h-2.5 w-2.5 rounded-full bg-violet-600" /> Wants
                </span>
                <span className="font-bold text-slate-900">{inr(x.wants, symbol)}</span>
              </div>
              <div className="progress mt-2">
                <span style={{width: `${(x.wants / splitTotal) * 100}%`, background: 'linear-gradient(90deg,#8b5cf6,#6d28d9)'}} />
              </div>
            </div>
          </div>
        </div>

        <div className="xl:col-span-1">
          {dash ? (
            <PaymentMix rows={dash.paymentMix} symbol={symbol} />
          ) : (
            <div className="skeleton h-[340px] rounded-3xl" />
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          {dash ? (
            <Recent rows={dash.recent} symbol={symbol} today={dash.today} onSaved={loadDash} />
          ) : (
            <div className="skeleton h-[420px] rounded-3xl" />
          )}
        </div>
        <div className="xl:col-span-1">
          {dash ? (
            <Upcoming
              cards={dash.upcoming.cards}
              subscriptions={dash.upcoming.subscriptions}
              recurring={dash.upcoming.recurring}
              emis={dash.emis}
              loans={dash.loans}
              splits={dash.splits}
              symbol={symbol}
            />
          ) : (
            <div className="skeleton h-[420px] rounded-3xl" />
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-4">
        <div className="xl:col-span-1">
          {dash ? (
            <TopCategories rows={dash.topCategories} symbol={symbol} />
          ) : (
            <div className="skeleton h-[300px] rounded-3xl" />
          )}
        </div>
        <div className="xl:col-span-2">
          <Goals symbol={symbol} />
        </div>
        <div className="xl:col-span-1">
          {dash ? (
            <NetWorthCard netWorth={dash.netWorth} symbol={symbol} />
          ) : (
            <div className="skeleton h-[300px] rounded-3xl" />
          )}
        </div>
      </div>
    </>
  );
}
