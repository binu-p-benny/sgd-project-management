-- Backfills 1A's secondary department for rows created before the step template assigned one.
-- 1A ("Welcome call + WhatsApp group + visit urgency decision") has always been owned by
-- HR & Admin, but Project Engineer needs visibility on it too — the template already reflects
-- this (see step-template.ts), so this only catches existing rows that predate that change.
UPDATE "phase_steps" SET "secondary_department" = 'project_engineer'
WHERE "step_code" = '1A' AND "secondary_department" IS NULL;
