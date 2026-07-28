-- CreateEnum
CREATE TYPE "Department" AS ENUM ('hr_admin', 'project_engineer', 'design_engineer', 'purchase', 'accounts', 'owner_admin');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'partial', 'received');

-- CreateEnum
CREATE TYPE "GlassType" AS ENUM ('normal', 'laminated');

-- CreateEnum
CREATE TYPE "VisitUrgency" AS ENUM ('emergency', 'hot', 'cold', 'site_not_ready');

-- CreateEnum
CREATE TYPE "ProjectPhase" AS ENUM ('phase_1', 'phase_2', 'phase_3', 'completed');

-- CreateEnum
CREATE TYPE "OverallStatus" AS ENUM ('on_track', 'delayed', 'blocked', 'completed');

-- CreateEnum
CREATE TYPE "StepPhase" AS ENUM ('phase_1', 'phase_2', 'phase_3');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('not_started', 'in_progress', 'blocked', 'completed');

-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('section', 'hardware', 'gasket');

-- CreateEnum
CREATE TYPE "BlockedReason" AS ENUM ('client_payment_hold', 'client_hold', 'site_not_ready', 'section_damage', 'powder_coating_damage', 'section_and_powder_coating_damage', 'hardware_damage', 'glass_damage', 'requirement_wrong_section', 'requirement_wrong_hardware', 'requirement_wrong_gasket', 'requirement_wrong_glass', 'vendor_issue_section', 'vendor_issue_hardware', 'vendor_issue_gasket', 'vendor_issue_glass', 'fabrication_damage_section', 'fabrication_damage_hardware', 'fabrication_damage_glass', 'transportation_damage_section', 'transportation_damage_hardware', 'transportation_damage_glass', 'wrong_tight_measurement', 'other');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "department" "Department" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "client_phone" TEXT NOT NULL,
    "client_address" TEXT NOT NULL,
    "final_cost" DECIMAL(12,2) NOT NULL,
    "amount_received" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "glass_type" "GlassType" NOT NULL,
    "rough_design_completed_at" TIMESTAMP(3),
    "visit_urgency" "VisitUrgency",
    "current_phase" "ProjectPhase" NOT NULL DEFAULT 'phase_1',
    "overall_status" "OverallStatus" NOT NULL DEFAULT 'on_track',
    "planned_start_date" TIMESTAMP(3),
    "planned_end_date" TIMESTAMP(3),
    "actual_start_date" TIMESTAMP(3),
    "actual_end_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phase_steps" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "phase" "StepPhase" NOT NULL,
    "step_code" TEXT NOT NULL,
    "step_name" TEXT NOT NULL,
    "owning_department" "Department" NOT NULL,
    "secondary_department" "Department",
    "planned_duration_days" INTEGER,
    "depends_on" TEXT[],
    "status" "StepStatus" NOT NULL DEFAULT 'not_started',
    "planned_start_date" TIMESTAMP(3),
    "planned_end_date" TIMESTAMP(3),
    "actual_start_date" TIMESTAMP(3),
    "actual_end_date" TIMESTAMP(3),
    "blocked_reason" "BlockedReason",
    "blocked_note" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "phase_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_items" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "item_type" "ItemType" NOT NULL,
    "requirement_created_at" TIMESTAMP(3),
    "quote_requested_at" TIMESTAMP(3),
    "quote_received_at" TIMESTAMP(3),
    "order_confirmed_at" TIMESTAMP(3),
    "payment_settled_at" TIMESTAMP(3),
    "expected_arrival_date" TIMESTAMP(3),
    "actual_arrival_date" TIMESTAMP(3),
    "qc_checked" BOOLEAN NOT NULL DEFAULT false,
    "qc_checked_at" TIMESTAMP(3),
    "qc_checked_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "step_status_log" (
    "id" TEXT NOT NULL,
    "phase_step_id" TEXT NOT NULL,
    "changed_by_user_id" TEXT NOT NULL,
    "old_status" "StepStatus" NOT NULL,
    "new_status" "StepStatus" NOT NULL,
    "reason" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "step_status_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_department_idx" ON "users"("department");

-- CreateIndex
CREATE INDEX "projects_current_phase_idx" ON "projects"("current_phase");

-- CreateIndex
CREATE INDEX "projects_overall_status_idx" ON "projects"("overall_status");

-- CreateIndex
CREATE INDEX "projects_payment_status_idx" ON "projects"("payment_status");

-- CreateIndex
CREATE INDEX "phase_steps_project_id_idx" ON "phase_steps"("project_id");

-- CreateIndex
CREATE INDEX "phase_steps_step_code_idx" ON "phase_steps"("step_code");

-- CreateIndex
CREATE INDEX "phase_steps_owning_department_idx" ON "phase_steps"("owning_department");

-- CreateIndex
CREATE INDEX "phase_steps_status_idx" ON "phase_steps"("status");

-- CreateIndex
CREATE INDEX "procurement_items_project_id_idx" ON "procurement_items"("project_id");

-- CreateIndex
CREATE INDEX "procurement_items_item_type_idx" ON "procurement_items"("item_type");

-- CreateIndex
CREATE INDEX "step_status_log_phase_step_id_idx" ON "step_status_log"("phase_step_id");

-- AddForeignKey
ALTER TABLE "phase_steps" ADD CONSTRAINT "phase_steps_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_items" ADD CONSTRAINT "procurement_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_items" ADD CONSTRAINT "procurement_items_qc_checked_by_fkey" FOREIGN KEY ("qc_checked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_status_log" ADD CONSTRAINT "step_status_log_phase_step_id_fkey" FOREIGN KEY ("phase_step_id") REFERENCES "phase_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_status_log" ADD CONSTRAINT "step_status_log_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
