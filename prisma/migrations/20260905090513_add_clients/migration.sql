-- Pulls client info out of Project/Service into its own Client table. Existing rows keep
-- their client info: it's copied into a Client row (one per distinct name/phone/address
-- combination, shared across projects and services) and linked via client_id before the
-- old denormalized columns are dropped, so nothing is lost.

-- 1. New clients table
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "clients_name_idx" ON "clients"("name");

-- 2. Nullable client_id columns first, so existing rows aren't rejected before the backfill runs
ALTER TABLE "projects" ADD COLUMN "client_id" TEXT;
ALTER TABLE "services" ADD COLUMN "client_id" TEXT;

-- 3. One Client row per distinct (name, phone, address) tuple already in use across
--    projects and services, then point every matching row at it.
WITH distinct_clients AS (
    SELECT DISTINCT "client_name" AS name, "client_phone" AS phone, "client_address" AS address FROM "projects"
    UNION
    SELECT DISTINCT "client_name" AS name, "client_phone" AS phone, "client_address" AS address FROM "services"
)
INSERT INTO "clients" ("id", "name", "phone", "address", "created_at", "updated_at")
SELECT substr(md5(random()::text || clock_timestamp()::text || name || phone || address), 1, 25),
       name, phone, address, now(), now()
FROM distinct_clients;

UPDATE "projects" p
SET "client_id" = c."id"
FROM "clients" c
WHERE p."client_name" = c."name" AND p."client_phone" = c."phone" AND p."client_address" = c."address";

UPDATE "services" s
SET "client_id" = c."id"
FROM "clients" c
WHERE s."client_name" = c."name" AND s."client_phone" = c."phone" AND s."client_address" = c."address";

-- 4. Now that every row is linked, make the relation required and drop the old columns
ALTER TABLE "projects" ALTER COLUMN "client_id" SET NOT NULL;
ALTER TABLE "projects" DROP COLUMN "client_name";
ALTER TABLE "projects" DROP COLUMN "client_phone";
ALTER TABLE "projects" DROP COLUMN "client_address";
CREATE INDEX "projects_client_id_idx" ON "projects"("client_id");
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "services" ALTER COLUMN "client_id" SET NOT NULL;
ALTER TABLE "services" DROP COLUMN "client_name";
ALTER TABLE "services" DROP COLUMN "client_phone";
ALTER TABLE "services" DROP COLUMN "client_address";
CREATE INDEX "services_client_id_idx" ON "services"("client_id");
ALTER TABLE "services" ADD CONSTRAINT "services_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
