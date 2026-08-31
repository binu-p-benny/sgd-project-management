-- AlterTable
ALTER TABLE "glass_action_items" ADD COLUMN     "department" "Department" NOT NULL DEFAULT 'purchase';

-- AlterTable
ALTER TABLE "procurement_action_items" ADD COLUMN     "department" "Department" NOT NULL DEFAULT 'purchase';
