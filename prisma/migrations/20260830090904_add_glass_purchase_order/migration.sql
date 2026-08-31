-- CreateTable
CREATE TABLE "glass_purchase_orders" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "requirement_created_at" TIMESTAMPTZ(3),
    "requirement_note" TEXT,
    "quote_created_at" TIMESTAMPTZ(3),
    "quote_note" TEXT,
    "payment_settled_at" TIMESTAMPTZ(3),
    "payment_note" TEXT,
    "order_confirmed_at" TIMESTAMPTZ(3),
    "order_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "glass_purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "glass_purchase_orders_project_id_key" ON "glass_purchase_orders"("project_id");

-- AddForeignKey
ALTER TABLE "glass_purchase_orders" ADD CONSTRAINT "glass_purchase_orders_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
