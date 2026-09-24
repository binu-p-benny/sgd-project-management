-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "website_review_asked" BOOLEAN,
ADD COLUMN     "website_review_note" TEXT,
ADD COLUMN     "website_reviewed_at" TIMESTAMPTZ(3);
