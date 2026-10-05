-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('none', 'daily', 'weekly', 'monthly');

-- CreateTable
CREATE TABLE "common_tasks" (
    "id" TEXT NOT NULL,
    "task_label" TEXT NOT NULL,
    "department" "Department" NOT NULL,
    "recurrence" "RecurrenceFrequency" NOT NULL DEFAULT 'none',
    "planned_date" TIMESTAMPTZ(3) NOT NULL,
    "actual_date" TIMESTAMPTZ(3),
    "last_completed_at" TIMESTAMPTZ(3),
    "note" TEXT,
    "created_by_user_id" TEXT,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "common_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "common_tasks_department_actual_date_idx" ON "common_tasks"("department", "actual_date");

-- CreateIndex
CREATE INDEX "common_tasks_deleted_at_idx" ON "common_tasks"("deleted_at");

-- AddForeignKey
ALTER TABLE "common_tasks" ADD CONSTRAINT "common_tasks_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
