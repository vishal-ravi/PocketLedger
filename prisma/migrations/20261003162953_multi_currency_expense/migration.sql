-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "fxRate" DECIMAL(12,6),
ADD COLUMN     "originalAmount" DECIMAL(14,2),
ADD COLUMN     "originalCurrency" TEXT;
