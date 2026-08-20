-- AlterTable
ALTER TABLE "procurement_items" ADD COLUMN     "arrival_planned_override" TIMESTAMPTZ(3),
ADD COLUMN     "order_planned_override" TIMESTAMPTZ(3),
ADD COLUMN     "payment_planned_override" TIMESTAMPTZ(3),
ADD COLUMN     "qc_planned_override" TIMESTAMPTZ(3),
ADD COLUMN     "quote_planned_override" TIMESTAMPTZ(3),
ADD COLUMN     "requirement_planned_override" TIMESTAMPTZ(3);
