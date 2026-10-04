import {NextResponse} from 'next/server';
import {pendingSplits, splitTotals} from '@/lib/debts';
import {requireUser} from '@/lib/auth';
import {sharedMemberIds} from '@/lib/household';

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const memberIds = await sharedMemberIds(auth.user.id);
  const totals = splitTotals(await pendingSplits(memberIds));
  return NextResponse.json(totals);
}
