CREATE TYPE "public"."backup_artifact_storage" AS ENUM('local', 'remote');--> statement-breakpoint
ALTER TABLE "backup_artifacts" ADD COLUMN "storage" "backup_artifact_storage" DEFAULT 'remote' NOT NULL;--> statement-breakpoint
