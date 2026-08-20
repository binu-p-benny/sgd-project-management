-- AlterTable
ALTER TABLE "procurement_items" ADD COLUMN     "action_plan_at" TIMESTAMPTZ(3),
ADD COLUMN     "action_plan_note" TEXT;
