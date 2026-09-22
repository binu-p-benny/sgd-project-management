-- CreateTable
CREATE TABLE "work_blocks" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "work_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_tasks" (
    "id" TEXT NOT NULL,
    "work_block_id" TEXT NOT NULL,
    "task_label" TEXT NOT NULL,
    "department" "Department" NOT NULL DEFAULT 'purchase',
    "is_pass_fail" BOOLEAN NOT NULL DEFAULT false,
    "planned_date" TIMESTAMPTZ(3) NOT NULL,
    "actual_date" TIMESTAMPTZ(3),
    "qc_passed" BOOLEAN,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "work_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_blocks_project_id_idx" ON "work_blocks"("project_id");

-- CreateIndex
CREATE INDEX "work_blocks_deleted_at_idx" ON "work_blocks"("deleted_at");

-- CreateIndex
CREATE INDEX "work_tasks_work_block_id_idx" ON "work_tasks"("work_block_id");

-- AddForeignKey
ALTER TABLE "work_blocks" ADD CONSTRAINT "work_blocks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_work_block_id_fkey" FOREIGN KEY ("work_block_id") REFERENCES "work_blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
