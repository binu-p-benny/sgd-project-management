-- 3E's final on-site QC check, its action plan, and custom follow-up rows under that plan —
-- all additive and nullable, so every existing step (3E included) starts unaffected.
ALTER TABLE "phase_steps" ADD COLUMN "qc_checked_at" TIMESTAMPTZ(3);
ALTER TABLE "phase_steps" ADD COLUMN "qc_passed" BOOLEAN;
ALTER TABLE "phase_steps" ADD COLUMN "action_plan_at" TIMESTAMPTZ(3);
ALTER TABLE "phase_steps" ADD COLUMN "action_plan_note" TEXT;

CREATE TABLE "phase_step_action_items" (
    "id" TEXT NOT NULL,
    "phase_step_id" TEXT NOT NULL,
    "task_label" TEXT NOT NULL,
    "department" "Department" NOT NULL DEFAULT 'project_engineer',
    "is_pass_fail" BOOLEAN NOT NULL DEFAULT false,
    "planned_date" TIMESTAMPTZ(3) NOT NULL,
    "actual_date" TIMESTAMPTZ(3),
    "qc_passed" BOOLEAN,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "phase_step_action_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "phase_step_action_items_phase_step_id_idx" ON "phase_step_action_items"("phase_step_id");

ALTER TABLE "phase_step_action_items" ADD CONSTRAINT "phase_step_action_items_phase_step_id_fkey" FOREIGN KEY ("phase_step_id") REFERENCES "phase_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
