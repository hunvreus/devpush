ALTER TABLE "backup_runs" ADD COLUMN "schedule_key" text;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "github_delivery_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "backup_runs_environment_schedule_idx" ON "backup_runs" USING btree ("environment_id","schedule_key") WHERE "backup_runs"."schedule_key" is not null;--> statement-breakpoint
WITH "ranked_active_backups" AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "environment_id"
			ORDER BY ("status" = 'running') DESC, "created_at" DESC, "id" DESC
		) AS "position"
	FROM "backup_runs"
	WHERE "status" IN ('queued', 'running')
)
UPDATE "backup_runs"
SET
	"status" = 'failed',
	"error_message" = 'Superseded while enabling serialized environment backups.',
	"finished_at" = now(),
	"updated_at" = now()
FROM "ranked_active_backups"
WHERE
	"backup_runs"."id" = "ranked_active_backups"."id"
	AND "ranked_active_backups"."position" > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "backup_runs_active_environment_idx" ON "backup_runs" USING btree ("environment_id") WHERE "backup_runs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "deployments_github_delivery_environment_idx" ON "deployments" USING btree ("github_delivery_id","environment_id") WHERE "deployments"."github_delivery_id" is not null;
