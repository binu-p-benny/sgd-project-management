-- AlterTable
ALTER TABLE "procurement_items" DROP COLUMN "quote_received_at",
DROP COLUMN "quote_requested_at",
ADD COLUMN     "payment_details" TEXT,
ADD COLUMN     "quote_created_at" TIMESTAMPTZ(3);
