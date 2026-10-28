DROP INDEX `deployments_server_idx`;--> statement-breakpoint
CREATE INDEX `deployments_server_status_idx` ON `deployments` (`server_id`,`status`);--> statement-breakpoint
CREATE INDEX `servers_agent_credential_idx` ON `servers` (`agent_credential_hash`) WHERE "servers"."agent_credential_hash" is not null;--> statement-breakpoint
CREATE INDEX `servers_pending_agent_credential_idx` ON `servers` (`pending_agent_credential_hash`) WHERE "servers"."pending_agent_credential_hash" is not null;--> statement-breakpoint
CREATE INDEX `servers_enrollment_token_idx` ON `servers` (`enrollment_token_hash`) WHERE "servers"."enrollment_token_hash" is not null;