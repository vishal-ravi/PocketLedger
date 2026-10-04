'use client';
import {inr, useCountUp} from '@/lib/use-count-up';

const tones: Record<string, string> = {
  emerald: 'bg-emerald-100 text-emerald-700',
  violet: 'bg-violet-100 text-violet-700',
  amber: 'bg-amber-100 text-amber-700',
  sky: 'bg-sky-100 text-sky-700',
  rose: 'bg-rose-100 text-rose-700',
};

type Props = {
  label: string;
  amount?: number;
  text?: string;
  symbol?: string;
  sub: string;
  icon?: React.ReactNode;
  tone?: keyof typeof tones;
  delay?: number;
  onDark?: boolean;
};

export function StatCard({label, amount = 0, text, symbol = '₹', sub, icon, tone = 'emerald', delay = 0, onDark = false}: Props) {
  const value = useCountUp(amount);

  return (
    <div
      className={`${onDark ? 'dark-card' : 'card card-lift'} p-5 anim`}
      style={{['--d' as string]: `${delay}ms`}}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={`text-[11px] font-bold uppercase tracking-[0.1em] ${onDark ? 'text-emerald-100/70' : 'text-slate-500'}`}>
          {label}
        </div>
        {icon && (
          <span className={`grid h-9 w-9 place-items-center rounded-xl ${onDark ? 'bg-white/15 text-emerald-50' : tones[tone]}`}>
            {icon}
          </span>
        )}
      </div>
      <div className={`mt-3 text-[26px] font-extrabold leading-none tracking-tight ${onDark ? 'text-white' : 'text-slate-900'}`}>
        {text ?? inr(value, symbol)}
      </div>
      <div className={`mt-2.5 text-[12px] ${onDark ? 'text-emerald-100/70' : 'text-slate-500'}`}>{sub}</div>
    </div>
  );
}
