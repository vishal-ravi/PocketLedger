import Link from 'next/link';
import {ArrowDownLeft, ArrowUpRight, CalendarClock, CreditCard, Landmark, Repeat} from 'lucide-react';
import {inr} from '@/lib/use-count-up';
import type {EmiRow, LoanBlock, SplitBlock, UpcomingCard, UpcomingRecurring, UpcomingSubscription} from '@/lib/dashboard';

const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', {day: 'numeric', month: 'short'});

function Countdown({days}: {days: number}) {
  const tone =
    days < 0 ? 'bg-rose-50 text-rose-600' : days <= 3 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600';
  const label = days < 0 ? `${Math.abs(days)}d late` : days === 0 ? 'Today' : `in ${days}d`;
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${tone}`}>{label}</span>;
}

export function Upcoming({
  cards,
  subscriptions,
  recurring,
  emis,
  loans,
  splits,
  symbol,
}: {
  cards: UpcomingCard[];
  subscriptions: UpcomingSubscription[];
  recurring: UpcomingRecurring[];
  emis: EmiRow[];
  loans: LoanBlock;
  splits: SplitBlock;
  symbol: string;
}) {
  const empty = cards.length === 0 && subscriptions.length === 0 && emis.length === 0 && recurring.length === 0;
  return (
    <div className="card p-5 anim" data-testid="upcoming-payments" style={{['--d' as string]: '140ms'}}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-slate-900">Upcoming payments</h2>
          <p className="text-xs text-slate-500">Card bills, EMIs and your recurring rules</p>
        </div>
        <Link href="/cards" className="link-underline text-xs font-bold text-emerald-700">
          Cards
        </Link>
      </div>

      {empty ? (
        <p className="rounded-2xl border border-dashed border-slate-200 p-5 text-center text-xs text-slate-400">
          Nothing scheduled — no cards or detected subscriptions yet.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {emis.map((emi) => (
            <li
              key={`${emi.loanId}-${emi.number}`}
              className="flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-3"
            >
              <span className="icon-tile-soft text-emerald-700">
                <Landmark size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-bold text-slate-900">
                  {emi.lenderName} · EMI {emi.number}
                </div>
                <div className="text-[11.5px] text-slate-500">
                  Due {fmt(emi.dueDate)} · {inr(emi.amount, symbol)}
                </div>
              </div>
              <Countdown days={emi.daysToDue} />
            </li>
          ))}
          {cards.map((card) => (
            <li
              key={card.id}
              className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3"
            >
              <span className="icon-tile-soft text-sky-600">
                <CreditCard size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-bold text-slate-900">{card.cardName}</div>
                <div className="text-[11.5px] text-slate-500">
                  Due {fmt(card.dueDate)} · bill {inr(card.projectedBill, symbol)}
                </div>
              </div>
              <Countdown days={card.daysToDue} />
            </li>
          ))}
          {recurring.map((rule) => (
            <li
              key={`recurring-${rule.id}`}
              className="flex items-center gap-3 rounded-2xl border border-sky-100 bg-sky-50/60 p-3"
            >
              <span className="icon-tile-soft text-sky-700">
                <Repeat size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-bold text-slate-900">{rule.description}</div>
                <div className="text-[11.5px] text-slate-500">
                  {fmt(rule.nextDue)} · {inr(rule.amount, symbol)} · {rule.interval.toLowerCase()}
                  {rule.autoPost ? '' : ' · reminder'}
                </div>
              </div>
              <Countdown days={rule.daysToDue} />
            </li>
          ))}
          {subscriptions.map((sub) => (
            <li
              key={`${sub.name}-${sub.nextDue}`}
              className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3"
            >
              <span className="icon-tile-soft text-violet-600">
                <Repeat size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-bold text-slate-900">{sub.name}</div>
                <div className="text-[11.5px] text-slate-500">
                  {fmt(sub.nextDue)} · {inr(sub.amount, symbol)}
                  {sub.overdue ? ' · overdue' : ''}
                </div>
              </div>
              <Countdown days={sub.daysToDue} />
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 border-t border-slate-100 pt-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">
            <CalendarClock size={13} /> Shared bills
          </span>
          <Link href="/expenses" className="link-underline text-xs font-bold text-emerald-700">
            Splits
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-emerald-50/70 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-emerald-700">
              <ArrowDownLeft size={13} /> You&apos;re owed
            </div>
            <div className="mt-1 text-[19px] font-extrabold text-slate-900">{inr(splits.receivable, symbol)}</div>
          </div>
          <div className="rounded-2xl bg-rose-50/70 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-rose-600">
              <ArrowUpRight size={13} /> You owe
            </div>
            <div className="mt-1 text-[19px] font-extrabold text-slate-900">{inr(splits.payable, symbol)}</div>
          </div>
        </div>

        {splits.people.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {splits.people.map((person) => (
              <span
                key={person.name}
                className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold ${
                  person.balance > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'
                }`}
              >
                {person.name} · {person.balance > 0 ? '+' : ''}
                {inr(person.balance, symbol)}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-[11.5px] text-slate-400">No open splits right now.</p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50 px-3.5 py-3">
          <span className="flex items-center gap-2 text-[12px] font-semibold text-slate-600">
            <Landmark size={14} className="text-emerald-600" />
            {loans.count} {loans.count === 1 ? 'loan' : 'loans'} · {inr(loans.outstanding, symbol)} outstanding
            {loans.overdue > 0 ? ` · ${loans.overdue} overdue` : ''}
          </span>
          <Link href="/loans" className="link-underline text-xs font-bold text-emerald-700">
            Manage EMIs
          </Link>
        </div>
      </div>
    </div>
  );
}
