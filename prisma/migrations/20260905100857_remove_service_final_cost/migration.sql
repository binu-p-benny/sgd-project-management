-- Services don't carry payment info (that's a Project-only concern — see PaymentSchedule),
-- so the final_cost column that was mirrored from Project doesn't apply here.
ALTER TABLE "services" DROP COLUMN "final_cost";
