import {DAY_MS, daysInMonth, daysUntil, isoDay, round2} from '@/lib/analytics';

export type GoalDto = {
  id: string;
  name: string;
  targetAmount: number;
  savedAmount: number;
  targetDate: string | null;
  colorCode: string;
  progress: number;
  remaining: number;
  daysLeft: number | null;
  perMonth: number;
};

export type GoalProjection = {
  monthsNeeded: number;
  reachDate: string | null;
  onTrack: boolean;
  shortfall: number;
};

function addMonths(date: Date, months: number): Date {
  const anchor = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const day = Math.min(date.getDate(), daysInMonth(anchor.getFullYear(), anchor.getMonth()));
  return new Date(anchor.getFullYear(), anchor.getMonth(), day);
}

/** Projects when a goal finishes if `contribution` is saved every month. */
export function projectGoal(input: {
  targetAmount: number;
  savedAmount: number;
  contribution: number;
  targetDate?: string | null;
  today?: Date;
}): GoalProjection {
  const target = Number(input.targetAmount);
  const saved = Number(input.savedAmount);
  const contribution = Number(input.contribution);
  const today = input.today ?? new Date();
  const remaining = round2(Math.max(0, target - saved));
  const targetIso = input.targetDate ? input.targetDate.slice(0, 10) : null;
  const targetDate = targetIso ? new Date(targetIso) : null;
  const monthsLeft =
    targetDate === null
      ? null
      : Math.max(0, Math.ceil((targetDate.getTime() - today.getTime()) / (30.44 * DAY_MS)));

  if (remaining <= 0) {
    return {monthsNeeded: 0, reachDate: isoDay(today), onTrack: true, shortfall: 0};
  }
  if (contribution <= 0) {
    return {
      monthsNeeded: 0,
      reachDate: null,
      onTrack: false,
      shortfall: round2(remaining),
    };
  }
  const monthsNeeded = Math.ceil(remaining / contribution);
  const reach = isoDay(addMonths(today, monthsNeeded));
  const onTrack = targetIso === null ? true : reach <= targetIso;
  const shortfall = monthsLeft === null ? 0 : round2(Math.max(0, remaining - contribution * monthsLeft));
  return {monthsNeeded, reachDate: reach, onTrack, shortfall};
}

type GoalRow = {
  id: string;
  name: string;
  targetAmount: unknown;
  savedAmount: unknown;
  targetDate: Date | null;
  colorCode: string;
};

/** Serialises a Goal with derived progress, remaining amount and pacing. */
export function toDto(goal: GoalRow): GoalDto {
  const target = Number(goal.targetAmount);
  const saved = Number(goal.savedAmount);
  const remaining = round2(Math.max(0, target - saved));
  const daysLeft = goal.targetDate ? daysUntil(goal.targetDate) : null;
  const monthsLeft = daysLeft !== null ? Math.max(1, Math.ceil(daysLeft / 30)) : 12;
  return {
    id: goal.id,
    name: goal.name,
    targetAmount: target,
    savedAmount: saved,
    targetDate: goal.targetDate ? goal.targetDate.toISOString().slice(0, 10) : null,
    colorCode: goal.colorCode,
    progress: target > 0 ? Math.min(100, round2((saved / target) * 100)) : 0,
    remaining,
    daysLeft,
    perMonth: remaining > 0 ? round2(remaining / monthsLeft) : 0,
  };
}
