-- AlterTable
ALTER TABLE "procurement_items" ADD COLUMN     "arrival_note" TEXT,
ADD COLUMN     "order_note" TEXT,
ADD COLUMN     "payment_note" TEXT,
ADD COLUMN     "qc_note" TEXT,
ADD COLUMN     "quote_note" TEXT,
ADD COLUMN     "requirement_note" TEXT;
