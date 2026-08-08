ALTER TABLE "deployments" RENAME COLUMN "config_snapshot" TO "config";--> statement-breakpoint
ALTER TABLE "deployments" RENAME COLUMN "env_vars_snapshot" TO "env_vars";--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "project_id" text;--> statement-breakpoint
UPDATE "deployments" AS "deployment"
SET "project_id" = "environment"."project_id"
FROM "environments" AS "environment"
WHERE "environment"."id" = "deployment"."environment_id";--> statement-breakpoint
ALTER TABLE "deployments" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
UPDATE "deployments"
SET "commit_meta" = jsonb_set(
  CASE
    WHEN jsonb_typeof("commit_meta") = 'object' THEN "commit_meta"
    ELSE '{}'::jsonb
  END,
  '{message}',
  to_jsonb("commit_message"),
  true
)
WHERE "commit_message" IS NOT NULL
  AND (
    "commit_meta" IS NULL
    OR jsonb_typeof("commit_meta") <> 'object'
    OR NOT "commit_meta" ? 'message'
    OR "commit_meta" -> 'message' = 'null'::jsonb
  );--> statement-breakpoint
UPDATE "deployments"
SET "config" = jsonb_build_object(
  'version', 2,
  'githubInstallationId', "config" #> '{repo,installationId}',
  'composePath', COALESCE("config" #>> '{compose,path}', 'compose.yml'),
  'releaseCommand', "config" #> '{compose,releaseCommand}',
  'releaseService', COALESCE("config" #>> '{compose,releaseService}', 'web'),
  'readinessPath', "config" #> '{compose,readinessPath}',
  'routes', COALESCE("config" #> '{compose,routes}', '[]'::jsonb)
)
WHERE "config" ->> 'version' = '1';--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deployments_project_idx" ON "deployments" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "deployments" DROP COLUMN "commit_message";
