import Link from 'next/link';
import {Landmark} from 'lucide-react';
import {inr} from '@/lib/use-count-up';
import type {NetWorth} from '@/lib/networth';

export function NetWorthCard({netWorth, symbol}: {netWorth: NetWorth; symbol: string}) {
  const negative = netWorth.netWorth < 0;
  return (
    <div className="card flex h-full flex-col p-5 anim" data-testid="net-worth" style={{['--d' as string]: '300ms'}}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-slate-900">Net worth</h2>
          <p className="text-xs text-slate-500">What you own minus what you owe</p>
        </div>
        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-indigo-50 text-indigo-600">
          <Landmark size={18} />
        </span>
      </div>

      <div className={`text-[26px] font-extrabold leading-none ${negative ? 'text-rose-600' : 'text-slate-900'}`}>
        {negative ? '-' : ''}
        {inr(Math.abs(netWorth.netWorth), symbol)}
      </div>

      <dl className="mt-4 space-y-2 text-[13px]">
        <div className="flex items-center justify-between">
          <dt className="text-slate-500">Assets (accounts)</dt>
          <dd className="font-bold text-emerald-600">{inr(netWorth.assets, symbol)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-slate-500">Card dues</dt>
          <dd className="font-bold text-rose-600">-{inr(netWorth.cardDues, symbol)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-slate-500">Loan outstanding</dt>
          <dd className="font-bold text-rose-600">-{inr(netWorth.loanOutstanding, symbol)}</dd>
        </div>
      </dl>

      <div className="mt-auto pt-4">
        <Link className="text-[13px] font-bold text-indigo-600 transition hover:text-indigo-700" href="/accounts">
          Manage accounts →
        </Link>
      </div>
    </div>
  );
}
