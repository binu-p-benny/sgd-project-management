-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "phase1_review_actual_end_date" TIMESTAMPTZ(3),
ADD COLUMN     "phase1_review_note" TEXT;
