-- AlterTable
ALTER TABLE "glass_action_items" ADD COLUMN     "is_pass_fail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "qc_passed" BOOLEAN;

-- AlterTable
ALTER TABLE "procurement_action_items" ADD COLUMN     "is_pass_fail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "qc_passed" BOOLEAN;
