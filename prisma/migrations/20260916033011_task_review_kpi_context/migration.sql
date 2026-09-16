/*
  Warnings:

  - Added the required column `completed_at` to the `task_reviews` table without a default value. This is not possible if the table is not empty.
  - Added the required column `context_name` to the `task_reviews` table without a default value. This is not possible if the table is not empty.
  - Added the required column `project_id` to the `task_reviews` table without a default value. This is not possible if the table is not empty.
  - Added the required column `task_label` to the `task_reviews` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "task_reviews" ADD COLUMN     "completed_at" TIMESTAMPTZ(3) NOT NULL,
ADD COLUMN     "context_name" TEXT NOT NULL,
ADD COLUMN     "project_id" TEXT NOT NULL,
ADD COLUMN     "task_label" TEXT NOT NULL;
