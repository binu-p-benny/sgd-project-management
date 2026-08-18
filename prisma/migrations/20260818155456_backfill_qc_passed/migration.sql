-- Backfills qc_passed for rows that were checked before Pass/Fail existed. "Checked" used to
-- mean only one thing (done, no outcome recorded), so every existing checked row is treated as
-- passed — lossless, since no failure was ever possible to record before this column existed.
-- Without this, 2F's completion check (qc_checked AND qc_passed = true) would silently regress
-- already-completed projects the next time their procurement data is touched.
UPDATE "procurement_items" SET "qc_passed" = true WHERE "qc_checked" = true AND "qc_passed" IS NULL;
