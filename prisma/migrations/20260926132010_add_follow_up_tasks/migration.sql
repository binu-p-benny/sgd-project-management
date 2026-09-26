-- CreateTable
CREATE TABLE "follow_up_tasks" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "phase_step_id" TEXT,
    "procurement_item_id" TEXT,
    "glass_purchase_order_id" TEXT,
    "task_label" TEXT NOT NULL,
    "department" "Department" NOT NULL DEFAULT 'project_engineer',
    "planned_date" TIMESTAMPTZ(3) NOT NULL,
    "actual_date" TIMESTAMPTZ(3),
    "note" TEXT,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "follow_up_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "follow_up_tasks_project_id_idx" ON "follow_up_tasks"("project_id");

-- CreateIndex
CREATE INDEX "follow_up_tasks_phase_step_id_idx" ON "follow_up_tasks"("phase_step_id");

-- CreateIndex
CREATE INDEX "follow_up_tasks_procurement_item_id_idx" ON "follow_up_tasks"("procurement_item_id");

-- CreateIndex
CREATE INDEX "follow_up_tasks_glass_purchase_order_id_idx" ON "follow_up_tasks"("glass_purchase_order_id");

-- CreateIndex
CREATE INDEX "follow_up_tasks_department_actual_date_idx" ON "follow_up_tasks"("department", "actual_date");

-- AddForeignKey
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_phase_step_id_fkey" FOREIGN KEY ("phase_step_id") REFERENCES "phase_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_procurement_item_id_fkey" FOREIGN KEY ("procurement_item_id") REFERENCES "procurement_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_glass_purchase_order_id_fkey" FOREIGN KEY ("glass_purchase_order_id") REFERENCES "glass_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
