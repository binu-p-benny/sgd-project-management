-- AlterTable
ALTER TABLE "procurement_items" ADD COLUMN     "arrived_for_powder_coating_planned_override" TIMESTAMPTZ(3),
ADD COLUMN     "material_despatch_planned_override" TIMESTAMPTZ(3);
