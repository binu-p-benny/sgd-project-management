-- AlterTable
ALTER TABLE "phase_steps" ADD COLUMN     "checklist_glass_issues" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "checklist_payment_details" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "checklist_project_schedule" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "checklist_team_intro" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "checklist_welcoming_message" BOOLEAN NOT NULL DEFAULT false;
