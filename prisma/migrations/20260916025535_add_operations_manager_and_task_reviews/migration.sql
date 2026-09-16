-- AlterEnum
ALTER TYPE "Department" ADD VALUE 'operations_manager';

-- CreateTable
CREATE TABLE "task_reviews" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "reviewed_at" TIMESTAMPTZ(3) NOT NULL,
    "review_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "task_reviews_task_id_key" ON "task_reviews"("task_id");
