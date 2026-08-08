ALTER TABLE "deployments" DROP CONSTRAINT "deployments_project_id_projects_id_fk";
--> statement-breakpoint
DROP INDEX "deployments_project_idx";--> statement-breakpoint
UPDATE "deployments"
SET "repo_id" = "projects"."github_repo_id"
FROM "environments"
INNER JOIN "projects" ON "projects"."id" = "environments"."project_id"
WHERE "deployments"."environment_id" = "environments"."id"
	AND "deployments"."repo_id" IS NULL
	AND "projects"."github_repo_id" IS NOT NULL;--> statement-breakpoint
UPDATE "deployments"
SET "commit_meta" = '{}'::jsonb
WHERE "commit_meta" IS NULL;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "deployments" WHERE "repo_id" IS NULL) THEN
		RAISE EXCEPTION 'Cannot require deployments.repo_id: unresolved legacy deployments remain';
	END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "deployments" ALTER COLUMN "repo_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "deployments" ALTER COLUMN "commit_meta" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "deployments" ALTER COLUMN "commit_meta" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "deployments" DROP COLUMN "project_id";--> statement-breakpoint
ALTER TABLE "deployments" DROP COLUMN "job_id";
