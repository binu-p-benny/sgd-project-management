-- AlterTable
ALTER TABLE "procurement_items" ADD COLUMN     "arrived_for_powder_coating_at" TIMESTAMPTZ(3),
ADD COLUMN     "arrived_for_powder_coating_note" TEXT,
ADD COLUMN     "material_despatch_at" TIMESTAMPTZ(3),
ADD COLUMN     "material_despatch_note" TEXT;
