CREATE TABLE "server_availability_windows" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "server_availability_windows" ADD CONSTRAINT "server_availability_windows_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "server_availability_windows" ("id", "server_id", "started_at")
SELECT 'initial-' || "id", "id", "created_at"
FROM "servers"
WHERE "status" NOT IN ('disabled', 'deleted');--> statement-breakpoint
CREATE INDEX "server_availability_windows_server_started_idx" ON "server_availability_windows" USING btree ("server_id","started_at");
