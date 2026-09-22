-- AlterTable
ALTER TABLE "phase_steps" ADD COLUMN     "planned_end_date_override" TIMESTAMPTZ(3),
ADD COLUMN     "planned_start_date_override" TIMESTAMPTZ(3);
