ALTER TABLE "agent_runtime_observations" ADD COLUMN "services" jsonb;--> statement-breakpoint
ALTER TABLE "server_metrics" ADD COLUMN "network_receive_bytes_per_second" double precision;--> statement-breakpoint
ALTER TABLE "server_metrics" ADD COLUMN "network_transmit_bytes_per_second" double precision;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "hostname" text;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "operating_system" text;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "kernel_version" text;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "architecture" text;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "cpu_core_count" integer;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "host_uptime_seconds" bigint;