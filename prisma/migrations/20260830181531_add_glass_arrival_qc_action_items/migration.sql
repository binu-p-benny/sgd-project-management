-- AlterTable
ALTER TABLE "glass_purchase_orders" ADD COLUMN     "action_plan_at" TIMESTAMPTZ(3),
ADD COLUMN     "action_plan_note" TEXT,
ADD COLUMN     "actual_arrival_date" TIMESTAMPTZ(3),
ADD COLUMN     "arrival_note" TEXT,
ADD COLUMN     "arrival_planned_date" TIMESTAMPTZ(3),
ADD COLUMN     "order_planned_date" TIMESTAMPTZ(3),
ADD COLUMN     "payment_planned_date" TIMESTAMPTZ(3),
ADD COLUMN     "qc_checked_at" TIMESTAMPTZ(3),
ADD COLUMN     "qc_checked_by" TEXT,
ADD COLUMN     "qc_note" TEXT,
ADD COLUMN     "qc_passed" BOOLEAN,
ADD COLUMN     "qc_planned_date" TIMESTAMPTZ(3),
ADD COLUMN     "quote_planned_date" TIMESTAMPTZ(3),
ADD COLUMN     "requirement_planned_date" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "glass_action_items" (
    "id" TEXT NOT NULL,
    "glass_purchase_order_id" TEXT NOT NULL,
    "task_label" TEXT NOT NULL,
    "planned_date" TIMESTAMPTZ(3) NOT NULL,
    "actual_date" TIMESTAMPTZ(3),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "glass_action_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "glass_action_items_glass_purchase_order_id_idx" ON "glass_action_items"("glass_purchase_order_id");

-- AddForeignKey
ALTER TABLE "glass_purchase_orders" ADD CONSTRAINT "glass_purchase_orders_qc_checked_by_fkey" FOREIGN KEY ("qc_checked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "glass_action_items" ADD CONSTRAINT "glass_action_items_glass_purchase_order_id_fkey" FOREIGN KEY ("glass_purchase_order_id") REFERENCES "glass_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
