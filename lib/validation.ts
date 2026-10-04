import {z} from 'zod';
import {fxIssue} from '@/lib/fx';

export const PAYMENT_METHODS = ['UPI', 'CREDIT_CARD', 'CASH', 'DEBIT_CARD', 'BANK_TRANSFER'] as const;
export const EXPENSE_TYPES = ['NEED', 'WANT', 'INCOME'] as const;

const id = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'invalid id');
const dayOfMonth = z.coerce.number().int().min(1).max(31);
const dateField = z
  .string()
  .trim()
  .min(1, 'required')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'must be a valid date (YYYY-MM-DD)')
  .transform((value) => new Date(value));

const expenseBase = z.object({
  date: dateField,
  description: z.string().trim().min(1, 'required').max(200),
  categoryId: id.nullish(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  creditCardId: id.nullish(),
  amount: z.coerce.number().positive('must be greater than 0').max(100000000),
  type: z.enum(EXPENSE_TYPES),
  notes: z.string().max(1000).nullish(),
  isSplit: z.boolean().optional(),
  whoPaid: z.string().trim().min(1).max(60).optional(),
  myShare: z.coerce.number().min(0).optional(),
  originalCurrency: z
    .string()
    .trim()
    .max(10)
    .transform((value) => value.toUpperCase())
    .nullish(),
  originalAmount: z.coerce.number().positive('must be greater than 0').max(100000000).nullish(),
  fxRate: z.coerce.number().positive('must be greater than 0').max(1000000).nullish(),
  splits: z
    .array(
      z.object({
        personName: z.string().trim().min(1).max(60),
        amountOwedToMe: z.coerce.number().min(0).default(0),
        amountIOwe: z.coerce.number().min(0).default(0),
        owedToPerson: z.string().trim().min(1).max(60).nullish(),
      }),
    )
    .max(50)
    .optional(),
});

// Income can be logged without a budget category (the source is free text);
// every other type must carry one.
export const expenseSchema = expenseBase.superRefine((value, ctx) => {
  if (value.type !== 'INCOME' && !value.categoryId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['categoryId'],
      message: 'required unless type is INCOME',
    });
  }
  const fxError = fxIssue(value);
  if (fxError) {
    ctx.addIssue({code: z.ZodIssueCode.custom, path: ['originalCurrency'], message: fxError});
  }
});

export const expensePatchSchema = expenseBase.partial();

export const categorySchema = z.object({
  name: z.string().trim().min(1, 'required').max(60),
  monthlyBudget: z.coerce.number().min(0).default(0),
  colorCode: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i, 'must be a hex colour like #6366f1')
    .default('#6366f1'),
  taxDeductible: z.boolean().default(false),
});

export const creditCardSchema = z.object({
  cardName: z.string().trim().min(1, 'required').max(60),
  creditLimit: z.coerce.number().positive('must be greater than 0').max(100000000),
  statementGenerationDay: dayOfMonth,
  dueDay: dayOfMonth,
  apr: z.coerce.number().min(0).max(100).nullish(),
  rewardsRate: z.coerce.number().min(0).max(100).nullish(),
  notes: z.string().max(500).nullish(),
});

export const goalSchema = z.object({
  name: z.string().trim().min(1, 'required').max(60),
  targetAmount: z.coerce.number().positive('must be greater than 0').max(100000000),
  savedAmount: z.coerce.number().min(0).max(100000000).optional(),
  targetDate: dateField.nullish(),
  colorCode: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i, 'must be a hex colour like #10b981')
    .default('#10b981'),
});

export const goalPatchSchema = goalSchema
  .partial()
  .extend({contribute: z.coerce.number().max(100000000).optional()});

export const loanSchema = z.object({
  lenderName: z.string().trim().min(1, 'required').max(60),
  principal: z.coerce.number().positive('must be greater than 0').max(100000000),
  annualRate: z.coerce.number().min(0).max(100).default(0),
  tenureMonths: z.coerce.number().int().min(1, 'at least 1 month').max(600),
  emiAmount: z.coerce.number().positive('must be greater than 0').max(100000000).optional(),
  startDate: dateField,
  categoryId: id.nullish(),
  paymentMethod: z.enum(PAYMENT_METHODS).default('UPI'),
  creditCardId: id.nullish(),
  notes: z.string().max(500).nullish(),
});

export const loanPatchSchema = z.object({
  lenderName: z.string().trim().min(1, 'required').max(60).optional(),
  categoryId: id.nullish(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  creditCardId: id.nullish(),
  notes: z.string().max(500).nullish(),
});

export const emiPaySchema = z.object({
  installmentId: id,
  date: dateField.optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  creditCardId: id.nullish(),
});

const recurringBase = z
  .object({
    description: z.string().trim().min(1, 'required').max(120),
    amount: z.coerce.number().positive('must be greater than 0').max(100000000),
    type: z.enum(EXPENSE_TYPES).default('NEED'),
    categoryId: id.nullish(),
    paymentMethod: z.enum(PAYMENT_METHODS).default('UPI'),
    creditCardId: id.nullish(),
    interval: z.enum(['WEEKLY', 'MONTHLY', 'YEARLY']).default('MONTHLY'),
    startDate: dateField,
    endDate: dateField.nullish(),
    autoPost: z.boolean().default(true),
    paused: z.boolean().default(false),
    notes: z.string().max(500).nullish(),
  });

export const recurringSchema = recurringBase.superRefine((value, ctx) => {
  if (value.type !== 'INCOME' && !value.categoryId) {
    ctx.addIssue({code: z.ZodIssueCode.custom, path: ['categoryId'], message: 'required unless type is INCOME'});
  }
  if (value.endDate && value.endDate < value.startDate) {
    ctx.addIssue({code: z.ZodIssueCode.custom, path: ['endDate'], message: 'must be on or after the start date'});
  }
});

export const recurringPatchSchema = recurringBase.partial();

export const repaymentSchema = z.object({
  personName: z.string().trim().min(1, 'required').max(60),
  direction: z.enum(['I_OWE', 'OWED_TO_ME']),
  amount: z.coerce.number().positive('must be greater than 0').max(100000000),
  date: dateField.optional(),
  note: z.string().max(300).nullish(),
});

export const userSchema = z.object({
  fullName: z.string().trim().min(1, 'required').max(80),
  currencySymbol: z.string().trim().min(1).max(5),
  monthlyIncome: z.coerce.number().min(0).max(100000000),
  budgetRollover: z.boolean(),
});

export const accountSchema = z.object({
  name: z.string().trim().min(1, 'required').max(60),
  type: z.enum(['BANK', 'CASH', 'WALLET', 'INVESTMENT', 'OTHER']),
  balance: z.coerce.number().min(-100000000).max(100000000),
});

export type AccountInput = z.infer<typeof accountSchema>;

export type ExpenseInput = z.infer<typeof expenseSchema>;

function message(error: z.ZodError) {
  return error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ');
}

export function validate<T>(schema: z.ZodType<T>, body: unknown): {data: T} | {error: string} {
  const result = schema.safeParse(body);
  return result.success ? {data: result.data} : {error: message(result.error)};
}
