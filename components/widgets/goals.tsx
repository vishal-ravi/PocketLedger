'use client';
import {useCallback, useEffect, useState} from 'react';
import {Plus, Target, Trash2} from 'lucide-react';
import {inr} from '@/lib/use-count-up';
import {projectGoal, type GoalDto} from '@/lib/goals';

const COLORS = ['#10b981', '#0ea5e9', '#7c3aed', '#f59e0b', '#e11d48'];

const fmtDate = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', {day: 'numeric', month: 'short', year: 'numeric'}) : null;

export function Goals({symbol}: {symbol: string}) {
  const [goals, setGoals] = useState<GoalDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({name: '', target: '', saved: '', date: '', color: COLORS[0]});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [paces, setPaces] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    fetch('/api/goals')
      .then((r) => r.json())
      .then((d) => setGoals(d.goals || []))
      .catch(() => setGoals([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createGoal(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (!form.name.trim()) return setError('Give the goal a name');
    if (!Number(form.target)) return setError('Enter a target amount');

    setBusy(true);
    try {
      const res = await fetch('/api/goals', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          name: form.name.trim(),
          targetAmount: Number(form.target),
          savedAmount: Number(form.saved || 0),
          targetDate: form.date || null,
          colorCode: form.color,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not save goal');
        return;
      }
      setForm({name: '', target: '', saved: '', date: '', color: COLORS[0]});
      setOpen(false);
      load();
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
  }

  async function contribute(goal: GoalDto) {
    const value = Number(amounts[goal.id] || 0);
    if (!value) return;
    setError('');
    await fetch(`/api/goals/${goal.id}`, {
      method: 'PATCH',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({contribute: value}),
    }).then(load);
    setAmounts((prev) => ({...prev, [goal.id]: ''}));
  }

  async function remove(goal: GoalDto) {
    if (!window.confirm(`Delete the "${goal.name}" goal?`)) return;
    await fetch(`/api/goals/${goal.id}`, {method: 'DELETE'}).then(load);
  }

  return (
    <div className="card p-5 anim" data-testid="savings-goals" style={{['--d' as string]: '300ms'}}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-slate-900">Savings goals</h2>
          <p className="text-xs text-slate-500">Track what you&apos;re setting aside</p>
        </div>
        <button className="btn btn-soft" type="button" onClick={() => setOpen((v) => !v)} data-testid="goal-toggle">
          <Plus size={15} /> {open ? 'Cancel' : 'New goal'}
        </button>
      </div>

      {open && (
        <form onSubmit={createGoal} className="mb-5 rounded-2xl bg-slate-50 p-4" data-testid="goal-form">
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <label className="label">
              Name
              <input
                className="input"
                placeholder="Emergency fund"
                value={form.name}
                onChange={(e) => setForm({...form, name: e.target.value})}
                data-testid="goal-name"
              />
            </label>
            <label className="label">
              Target
              <input
                className="input"
                inputMode="decimal"
                placeholder="300000"
                value={form.target}
                onChange={(e) => setForm({...form, target: e.target.value})}
                data-testid="goal-target"
              />
            </label>
            <label className="label">
              Saved so far
              <input
                className="input"
                inputMode="decimal"
                placeholder="0"
                value={form.saved}
                onChange={(e) => setForm({...form, saved: e.target.value})}
                data-testid="goal-saved"
              />
            </label>
            <label className="label">
              Target date
              <input
                className="input"
                type="date"
                value={form.date}
                onChange={(e) => setForm({...form, date: e.target.value})}
                data-testid="goal-date"
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">Colour</span>
            {COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`colour ${color}`}
                onClick={() => setForm({...form, color})}
                className={`h-6 w-6 rounded-full border-2 ${form.color === color ? 'border-slate-900' : 'border-white'}`}
                style={{background: color, boxShadow: '0 0 0 1px #e2e8f0'}}
              />
            ))}
            <span className="grow" />
            <button className="btn btn-primary" type="submit" disabled={busy} data-testid="goal-save">
              {busy ? 'Saving…' : 'Save goal'}
            </button>
          </div>
          {error && (
            <p className="mt-2 text-[12.5px] font-semibold text-rose-600" data-testid="goal-error">
              {error}
            </p>
          )}
        </form>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="skeleton h-28 rounded-2xl" />
          <div className="skeleton h-28 rounded-2xl" />
        </div>
      ) : goals.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
          No goals yet — set a target for your emergency fund, trip or gadget.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {goals.map((goal) => {
            const dateLabel = fmtDate(goal.targetDate);
            const paceValue = paces[goal.id] ?? String(goal.perMonth);
            const projection = projectGoal({
              targetAmount: goal.targetAmount,
              savedAmount: goal.savedAmount,
              contribution: Number(paceValue) || 0,
              targetDate: goal.targetDate,
            });
            const complete = goal.remaining <= 0;
            const reachLabel = fmtDate(projection.reachDate);
            return (
              <div key={goal.id} className="rounded-2xl border border-slate-100 bg-white p-4" data-testid="goal-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="icon-tile-soft" style={{color: goal.colorCode}}>
                      <Target size={16} />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-bold text-slate-900">{goal.name}</div>
                      <div className="text-[11.5px] text-slate-500">
                        {dateLabel ? `${dateLabel} · ${goal.daysLeft ?? 0} days left` : 'No target date'}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`delete ${goal.name}`}
                    onClick={() => remove(goal)}
                    className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                    data-testid="goal-delete"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>

                <div className="mt-3 flex items-baseline justify-between">
                  <span className="text-[20px] font-extrabold text-slate-900">{inr(goal.savedAmount, symbol)}</span>
                  <span className="text-[12px] font-semibold text-slate-500">of {inr(goal.targetAmount, symbol)}</span>
                </div>
                <div className="progress mt-2">
                  <span style={{width: `${goal.progress}%`, background: goal.colorCode}} />
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-slate-500">
                  <span className="font-bold" style={{color: goal.colorCode}}>
                    {goal.progress}% funded
                  </span>
                  <span>
                    {inr(goal.remaining, symbol)} to go
                    {goal.perMonth > 0 ? ` · ${inr(goal.perMonth, symbol)}/mo` : ''}
                  </span>
                </div>

                <div className="mt-3 flex gap-2">
                  <input
                    className="input flex-1"
                    inputMode="decimal"
                    placeholder="Add amount"
                    value={amounts[goal.id] ?? ''}
                    onChange={(e) => setAmounts({...amounts, [goal.id]: e.target.value})}
                    data-testid="goal-contribute-input"
                  />
                  <button
                    type="button"
                    className="btn btn-soft"
                    onClick={() => contribute(goal)}
                    data-testid="goal-contribute"
                  >
                    Add
                  </button>
                </div>

                <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400" htmlFor={`pace-${goal.id}`}>
                      Save /mo
                    </label>
                    <input
                      id={`pace-${goal.id}`}
                      className="input h-8 w-24 py-1 text-[13px]"
                      inputMode="decimal"
                      value={paceValue}
                      onChange={(e) => setPaces({...paces, [goal.id]: e.target.value})}
                      data-testid="goal-pace"
                    />
                    <span className="grow" />
                    {complete ? (
                      <span className="badge badge-need" data-testid="goal-eta-status">Fully funded</span>
                    ) : (
                      <span
                        className={`badge ${projection.onTrack ? 'badge-need' : 'badge-want'}`}
                        data-testid="goal-eta-status"
                      >
                        {goal.targetDate ? (projection.onTrack ? 'On track' : 'Behind') : projection.monthsNeeded + ' mo'}
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 text-[11.5px] font-semibold text-slate-500" data-testid="goal-eta">
                    {complete
                      ? 'Fully funded — nothing left to save'
                      : projection.reachDate
                        ? `Finish by ${reachLabel}`
                        : 'Enter a monthly pace to see your finish date'}
                    {!complete && projection.shortfall > 0 && goal.targetDate
                      ? ` · ${inr(projection.shortfall, symbol)} short by deadline`
                      : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && !open && (
        <p className="mt-3 text-[12.5px] font-semibold text-rose-600">{error}</p>
      )}
    </div>
  );
}
