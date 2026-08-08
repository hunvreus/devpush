CREATE TYPE "public"."alias_type" AS ENUM('deployment', 'environment', 'branch');--> statement-breakpoint
CREATE TYPE "public"."domain_status" AS ENUM('pending', 'active', 'disabled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."environment_status" AS ENUM('active', 'deleted');--> statement-breakpoint
CREATE TABLE "aliases" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"deployment_id" text,
	"previous_deployment_id" text,
	"hostname" text NOT NULL,
	"type" "alias_type" NOT NULL,
	"https" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"hostname" text NOT NULL,
	"base_path" text,
	"https" boolean DEFAULT true NOT NULL,
	"status" "domain_status" DEFAULT 'pending' NOT NULL,
	"message" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "github_installation_id" bigint;--> statement-breakpoint
ALTER TABLE "environments" ADD COLUMN "color" text DEFAULT 'blue' NOT NULL;--> statement-breakpoint
ALTER TABLE "environments" ADD COLUMN "status" "environment_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "release_service" text;--> statement-breakpoint
INSERT INTO "environments" (
	"id",
	"project_id",
	"server_id",
	"name",
	"slug",
	"branch",
	"is_production",
	"color",
	"status",
	"runtime_id",
	"created_at",
	"updated_at"
)
SELECT
	item.value ->> 'id',
	project."id",
	COALESCE(
		(
			SELECT assignment."server_id"
			FROM "project_servers" AS assignment
			WHERE assignment."project_id" = project."id"
				AND assignment."environment_id" = item.value ->> 'id'
			LIMIT 1
		),
		(
			SELECT assignment."server_id"
			FROM "project_servers" AS assignment
			WHERE assignment."project_id" = project."id"
				AND assignment."environment_id" IS NULL
			LIMIT 1
		)
	),
	COALESCE(NULLIF(item.value ->> 'name', ''), item.value ->> 'slug'),
	item.value ->> 'slug',
	item.value ->> 'branch',
	(item.value ->> 'slug') = 'production',
	COALESCE(NULLIF(item.value ->> 'color', ''), 'blue'),
	CASE
		WHEN item.value ->> 'status' = 'deleted' THEN 'deleted'::"environment_status"
		ELSE 'active'::"environment_status"
	END,
	'dp_' ||
		rpad(substr(regexp_replace(lower(project."id"), '[^a-z0-9]', '', 'g'), 1, 10), 10, '0') ||
		'_' ||
		rpad(substr(regexp_replace(lower(item.value ->> 'id'), '[^a-z0-9]', '', 'g'), 1, 10), 10, '0'),
	project."created_at",
	project."updated_at"
FROM "projects" AS project
CROSS JOIN LATERAL jsonb_array_elements(
	CASE
		WHEN jsonb_typeof(project."environments") = 'array' THEN project."environments"
		ELSE '[]'::jsonb
	END
) AS item(value)
WHERE NULLIF(item.value ->> 'id', '') IS NOT NULL
	AND NULLIF(item.value ->> 'slug', '') IS NOT NULL
	AND NULLIF(item.value ->> 'branch', '') IS NOT NULL
ON CONFLICT ("project_id", "slug") DO NOTHING;--> statement-breakpoint
UPDATE "environments" AS environment
SET "server_id" = COALESCE(
	environment."server_id",
	(
		SELECT assignment."server_id"
		FROM "project_servers" AS assignment
		WHERE assignment."project_id" = environment."project_id"
			AND assignment."environment_id" = environment."id"
		LIMIT 1
	),
	(
		SELECT assignment."server_id"
		FROM "project_servers" AS assignment
		WHERE assignment."project_id" = environment."project_id"
			AND assignment."environment_id" IS NULL
		LIMIT 1
	)
);--> statement-breakpoint
WITH project_environment_config AS (
	SELECT
		project."id" AS project_id,
		item.value
	FROM "projects" AS project
	CROSS JOIN LATERAL jsonb_array_elements(
		CASE
			WHEN jsonb_typeof(project."environments") = 'array' THEN project."environments"
			ELSE '[]'::jsonb
		END
	) AS item(value)
)
UPDATE "environments" AS environment
SET
	"name" = COALESCE(NULLIF(config.value ->> 'name', ''), environment."name"),
	"branch" = COALESCE(NULLIF(config.value ->> 'branch', ''), environment."branch"),
	"color" = COALESCE(NULLIF(config.value ->> 'color', ''), environment."color"),
	"status" = CASE
		WHEN config.value ->> 'status' = 'deleted' THEN 'deleted'::"environment_status"
		ELSE environment."status"
	END
FROM project_environment_config AS config
WHERE config.project_id = environment."project_id"
	AND config.value ->> 'id' = environment."id";--> statement-breakpoint
INSERT INTO "aliases" (
	"id",
	"project_id",
	"environment_id",
	"deployment_id",
	"hostname",
	"type",
	"https",
	"created_at",
	"updated_at"
)
SELECT
	"id",
	"project_id",
	"environment_id",
	"deployment_id",
	"hostname",
	CASE "type"::text
		WHEN 'deployment_alias' THEN 'deployment'::"alias_type"
		WHEN 'branch_alias' THEN 'branch'::"alias_type"
		ELSE 'environment'::"alias_type"
	END,
	"https",
	"created_at",
	"updated_at"
FROM "hostnames"
WHERE "environment_id" IS NOT NULL
	AND "status" = 'active'
	AND "type" <> 'custom_domain';--> statement-breakpoint
INSERT INTO "domains" (
	"id",
	"project_id",
	"environment_id",
	"hostname",
	"base_path",
	"https",
	"status",
	"message",
	"verified_at",
	"created_at",
	"updated_at"
)
SELECT
	"id",
	"project_id",
	"environment_id",
	"hostname",
	"base_path",
	"https",
	CASE "status"::text
		WHEN 'disabled' THEN 'disabled'::"domain_status"
		WHEN 'failed' THEN 'failed'::"domain_status"
		WHEN 'pending' THEN 'pending'::"domain_status"
		ELSE 'active'::"domain_status"
	END,
	"message",
	"verified_at",
	"created_at",
	"updated_at"
FROM "hostnames"
WHERE "environment_id" IS NOT NULL
	AND "type" = 'custom_domain';--> statement-breakpoint
UPDATE "deployments" AS deployment
SET
	"github_installation_id" = COALESCE(
		CASE
			WHEN deployment."config" ->> 'githubInstallationId' ~ '^[0-9]+$'
			THEN (deployment."config" ->> 'githubInstallationId')::bigint
		END,
		project."github_installation_id"
	),
	"config" = deployment."config" - 'githubInstallationId'
FROM "projects" AS project
WHERE project."id" = deployment."project_id";--> statement-breakpoint
ALTER TABLE "aliases" ADD CONSTRAINT "aliases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aliases" ADD CONSTRAINT "aliases_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aliases" ADD CONSTRAINT "aliases_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aliases" ADD CONSTRAINT "aliases_previous_deployment_id_deployments_id_fk" FOREIGN KEY ("previous_deployment_id") REFERENCES "public"."deployments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "aliases_hostname_idx" ON "aliases" USING btree ("hostname");--> statement-breakpoint
CREATE INDEX "aliases_project_idx" ON "aliases" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "aliases_environment_idx" ON "aliases" USING btree ("environment_id");--> statement-breakpoint
CREATE INDEX "aliases_deployment_idx" ON "aliases" USING btree ("deployment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "domains_hostname_idx" ON "domains" USING btree ("hostname");--> statement-breakpoint
CREATE INDEX "domains_project_idx" ON "domains" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "domains_environment_idx" ON "domains" USING btree ("environment_id");--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_github_installation_id_github_installations_installation_id_fk" FOREIGN KEY ("github_installation_id") REFERENCES "public"."github_installations"("installation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hostnames" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_servers" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "hostnames" CASCADE;--> statement-breakpoint
DROP TABLE "project_servers" CASCADE;--> statement-breakpoint
ALTER TABLE "environments" DROP COLUMN "default_host";--> statement-breakpoint
ALTER TABLE "environments" DROP COLUMN "env_vars";--> statement-breakpoint
ALTER TABLE "environments" DROP COLUMN "public_routes";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "environments";--> statement-breakpoint
DROP TYPE "public"."hostname_status";--> statement-breakpoint
DROP TYPE "public"."hostname_type";
