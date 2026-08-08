ALTER TABLE "deployments" DROP CONSTRAINT "deployments_github_installation_id_github_installations_installation_id_fk";
--> statement-breakpoint
ALTER TABLE "environments" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH ranked AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "project_id"
			ORDER BY "is_production" DESC, "created_at", "id"
		) - 1 AS "position"
	FROM "environments"
)
UPDATE "environments" AS environment
SET "position" = ranked."position"
FROM ranked
WHERE environment."id" = ranked."id";--> statement-breakpoint
ALTER TABLE "deployments" DROP COLUMN "github_installation_id";
