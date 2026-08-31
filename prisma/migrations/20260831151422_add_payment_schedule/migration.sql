-- CreateTable
CREATE TABLE "payment_schedules" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "token_received_at" TIMESTAMPTZ(3),
    "milestone_1_received_at" TIMESTAMPTZ(3),
    "milestone_2_received_at" TIMESTAMPTZ(3),
    "milestone_3_received_at" TIMESTAMPTZ(3),
    "milestone_4_received_at" TIMESTAMPTZ(3),
    "milestone_5_received_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_schedules_project_id_key" ON "payment_schedules"("project_id");

-- AddForeignKey
ALTER TABLE "payment_schedules" ADD CONSTRAINT "payment_schedules_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
