-- AlterTable
ALTER TABLE "phase_steps" ADD COLUMN     "contractor_id" TEXT;

-- AddForeignKey
ALTER TABLE "phase_steps" ADD CONSTRAINT "phase_steps_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
