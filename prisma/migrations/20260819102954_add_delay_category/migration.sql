-- CreateEnum
CREATE TYPE "DelayCategory" AS ENUM ('client_side', 'in_house');

-- AlterTable
ALTER TABLE "phase_steps" ADD COLUMN     "delay_category" "DelayCategory";
