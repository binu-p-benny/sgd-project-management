-- A service now only reads "completed" once this is explicitly set (see getServiceStatus in
-- lib/service.ts) — nullable and additive, so every existing service starts unaffected (not
-- completed) until someone marks it so.
ALTER TABLE "services" ADD COLUMN "completed_at" TIMESTAMPTZ(3);
