ALTER TABLE "servers" ADD COLUMN "agent_credential_hash" text;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "pending_agent_credential_hash" text;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "agent_credential_rotated_at" timestamp with time zone;--> statement-breakpoint
UPDATE "servers"
SET "agent_credential_hash" = "enrollment_token_hash"
WHERE "status" IN ('connected', 'disconnected')
  AND "enrollment_token_hash" IS NOT NULL;--> statement-breakpoint
UPDATE "servers"
SET "enrollment_token_hash" = NULL,
    "enrollment_token_expires_at" = NULL
WHERE "agent_credential_hash" IS NOT NULL;
