-- Income entries don't belong to a budget category (the source is free text),
-- so the category link becomes optional for type = INCOME.
ALTER TABLE "Expense" ALTER COLUMN "categoryId" DROP NOT NULL;
