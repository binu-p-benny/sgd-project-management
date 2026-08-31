-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "phase3_review_actual_end_date" TIMESTAMPTZ(3),
ADD COLUMN     "phase3_review_note" TEXT;
