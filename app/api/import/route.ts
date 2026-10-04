import {NextRequest, NextResponse} from 'next/server';
import {z} from 'zod';
import {prisma} from '@/lib/prisma';
import {PAYMENT_METHODS} from '@/lib/validation';
import {requireUser} from '@/lib/auth';
import {sharedMemberIds} from '@/lib/household';
import {csvToRows, ofxToRows, rowKey, type ParsedRow, type RowIssue} from '@/lib/import';

const importSchema = z.object({
  format: z.enum(['CSV', 'OFX']).default('CSV'),
  content: z.string().min(1, 'file is empty').max(3_000_000, 'file is too large (max ~2MB)'),
  dryRun: z.boolean().default(false),
  categoryId: z.string().nullish(),
  paymentMethod: z.enum(PAYMENT_METHODS).default('UPI'),
  creditCardId: z.string().nullish(),
  positiveAs: z.enum(['INCOME', 'NEED']).default('INCOME'),
  dedupe: z.boolean().default(true),
});

const MAX_ROWS = 5000;

type PlannedRow = {
  line: number;
  date: string;
  description: string;
  amount: number;
  type: 'NEED' | 'WANT' | 'INCOME';
  categoryName: string | null;
};

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const memberIds = await sharedMemberIds(auth.user.id);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({error: 'invalid JSON body'}, {status: 400});
  }
  const parsed = importSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({error: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')}, {status: 400});
  }
  const input = parsed.data;

  const [fallbackCategory, card] = await Promise.all([
    input.categoryId ? prisma.category.findFirst({where: {id: input.categoryId, userId: {in: memberIds}}}) : null,
    input.creditCardId ? prisma.creditCard.findFirst({where: {id: input.creditCardId, userId: {in: memberIds}}}) : null,
  ]);
  if (input.categoryId && !fallbackCategory) return NextResponse.json({error: 'categoryId: unknown category'}, {status: 400});
  if (input.creditCardId && !card) return NextResponse.json({error: 'creditCardId: unknown card'}, {status: 400});

  const useOfx = input.format === 'OFX' || /<STMTTRN>/i.test(input.content);
  const result = useOfx ? ofxToRows(input.content) : csvToRows(input.content, {positiveAs: input.positiveAs});
  const issues: RowIssue[] = [...result.issues];
  const rows: ParsedRow[] = result.rows;

  if (rows.length === 0) {
    return NextResponse.json({imported: 0, planned: 0, duplicates: 0, skipped: 0, issues, preview: [], source: useOfx ? 'OFX' : 'CSV'});
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json({error: `too many rows (${rows.length}); the limit is ${MAX_ROWS}`}, {status: 400});
  }

  const categories = await prisma.category.findMany({where: {userId: {in: memberIds}}, select: {id: true, name: true}});
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));

  // Duplicate detection: within the file and against the ledger over the file's date range.
  const dates = rows.map((row) => row.date).sort();
  const seen = new Set<string>();
  const existingKeys = new Set<string>();
  if (input.dedupe) {
    const existing = await prisma.expense.findMany({
      where: {userId: {in: memberIds}, date: {gte: new Date(`${dates[0]}T00:00:00.000Z`), lte: new Date(`${dates[dates.length - 1]}T23:59:59.999Z`)}},
      select: {date: true, description: true, amount: true},
      take: 20000,
    });
    for (const row of existing) {
      existingKeys.add(
        rowKey({date: row.date.toISOString().slice(0, 10), description: row.description, amount: Number(row.amount)}),
      );
    }
  }

  let duplicates = 0;
  let skipped = 0;
  const planned: PlannedRow[] = [];
  type Method = (typeof PAYMENT_METHODS)[number];
  const createData: {
    userId: string;
    date: Date;
    categoryId: string | null;
    description: string;
    paymentMethod: Method;
    amount: number;
    type: 'NEED' | 'WANT' | 'INCOME';
    notes: string | null;
    isSplit: boolean;
    whoPaid: string;
    myShare: number;
    creditCardId: string | null;
  }[] = [];

  for (const row of rows) {
    const key = rowKey(row);
    if (input.dedupe && (seen.has(key) || existingKeys.has(key))) {
      duplicates++;
      continue;
    }
    seen.add(key);

    const matchedId = row.categoryName ? (byName.get(row.categoryName.toLowerCase()) ?? null) : null;
    const categoryId = matchedId ?? (row.type === 'INCOME' ? null : (input.categoryId ?? null));
    if (row.type !== 'INCOME' && !categoryId) {
      skipped++;
      issues.push({line: row.line, message: `row ${row.line}: no category — pick a fallback category and retry`});
      continue;
    }

    planned.push({
      line: row.line,
      date: row.date,
      description: row.description,
      amount: row.amount,
      type: row.type,
      categoryName: matchedId ? categories.find((c) => c.id === matchedId)?.name ?? null : null,
    });
    createData.push({
      userId: auth.user.id,
      date: new Date(`${row.date}T12:00:00.000Z`),
      categoryId,
      description: row.description,
      paymentMethod: row.type === 'INCOME' ? (input.paymentMethod === 'CREDIT_CARD' ? 'BANK_TRANSFER' : input.paymentMethod) : input.paymentMethod,
      amount: row.amount,
      type: row.type,
      notes: null,
      isSplit: false,
      whoPaid: 'Me',
      myShare: row.amount,
      creditCardId: row.type === 'INCOME' || input.paymentMethod !== 'CREDIT_CARD' ? null : (input.creditCardId ?? null),
    });
  }

  if (input.dryRun) {
    return NextResponse.json({
      imported: 0,
      planned: planned.length,
      duplicates,
      skipped,
      issues,
      source: useOfx ? 'OFX' : 'CSV',
      preview: planned.slice(0, 50),
    });
  }

  if (createData.length > 0) {
    await prisma.expense.createMany({data: createData});
  }
  return NextResponse.json({
    imported: createData.length,
    planned: planned.length,
    duplicates,
    skipped,
    issues,
    source: useOfx ? 'OFX' : 'CSV',
    preview: planned.slice(0, 50),
  });
}
