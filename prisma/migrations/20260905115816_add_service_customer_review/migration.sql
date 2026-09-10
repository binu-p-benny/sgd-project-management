-- Customer review follow-up for a completed service — planned date (completedAt + 2 days) is
-- computed live in getServiceStatus, never stored. Additive and nullable: every existing
-- service starts with no review recorded until one is filled in or the service is re-completed.
ALTER TABLE "services" ADD COLUMN "review_completed_at" TIMESTAMPTZ(3);
ALTER TABLE "services" ADD COLUMN "review_note" TEXT;
