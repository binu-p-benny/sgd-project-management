-- CreateTable
CREATE TABLE "procurement_action_items" (
    "id" TEXT NOT NULL,
    "procurement_item_id" TEXT NOT NULL,
    "task_label" TEXT NOT NULL,
    "planned_date" TIMESTAMPTZ(3) NOT NULL,
    "actual_date" TIMESTAMPTZ(3),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "procurement_action_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "procurement_action_items_procurement_item_id_idx" ON "procurement_action_items"("procurement_item_id");

-- AddForeignKey
ALTER TABLE "procurement_action_items" ADD CONSTRAINT "procurement_action_items_procurement_item_id_fkey" FOREIGN KEY ("procurement_item_id") REFERENCES "procurement_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
