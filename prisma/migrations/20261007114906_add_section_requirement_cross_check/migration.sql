-- AlterTable
ALTER TABLE "procurement_items" ADD COLUMN     "requirement_cross_check_at" TIMESTAMPTZ(3),
ADD COLUMN     "requirement_cross_check_note" TEXT;
