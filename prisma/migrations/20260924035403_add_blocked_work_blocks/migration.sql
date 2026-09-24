-- AlterTable
ALTER TABLE "work_blocks" ADD COLUMN     "blocked_phase_step_id" TEXT;

-- AddForeignKey
ALTER TABLE "work_blocks" ADD CONSTRAINT "work_blocks_blocked_phase_step_id_fkey" FOREIGN KEY ("blocked_phase_step_id") REFERENCES "phase_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;
