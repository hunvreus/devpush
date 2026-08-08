ALTER TABLE "projects" ADD COLUMN "default_server_id" text;--> statement-breakpoint
UPDATE "projects"
SET "default_server_id" = (
	SELECT "environments"."server_id"
	FROM "environments"
	WHERE "environments"."project_id" = "projects"."id"
		AND "environments"."status" = 'active'
	ORDER BY "environments"."is_production" DESC, "environments"."position", "environments"."created_at"
	LIMIT 1
);--> statement-breakpoint
UPDATE "environments"
SET "server_id" = NULL
FROM "projects"
WHERE "environments"."project_id" = "projects"."id"
	AND "projects"."default_server_id" IS NOT NULL
	AND "environments"."server_id" = "projects"."default_server_id";--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_default_server_id_servers_id_fk" FOREIGN KEY ("default_server_id") REFERENCES "public"."servers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_default_server_idx" ON "projects" USING btree ("default_server_id");
