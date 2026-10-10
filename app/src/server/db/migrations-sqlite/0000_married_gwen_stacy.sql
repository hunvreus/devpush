CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`provider_account_name` text,
	`provider_account_email` text,
	`provider_account_username` text,
	`provider_account_image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `agent_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`server_id` text NOT NULL,
	`team_id` text,
	`project_id` text,
	`payload` text NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`error_message` text,
	`claimed_at` integer,
	`available_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`finished_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agent_jobs_type_enum" CHECK("agent_jobs"."type" in ('deploy', 'deprovision', 'purge', 'backup', 'restore', 'backup_cleanup')),
	CONSTRAINT "agent_jobs_status_enum" CHECK("agent_jobs"."status" in ('queued', 'running', 'succeeded', 'failed', 'canceled', 'abandoned'))
);
--> statement-breakpoint
CREATE INDEX `agent_jobs_server_status_idx` ON `agent_jobs` (`server_id`,`status`);--> statement-breakpoint
CREATE INDEX `agent_jobs_project_idx` ON `agent_jobs` (`project_id`);--> statement-breakpoint
CREATE INDEX `agent_jobs_team_idx` ON `agent_jobs` (`team_id`);--> statement-breakpoint
CREATE TABLE `agent_runtime_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`runtime_id` text NOT NULL,
	`services` text,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`cleanup_queued_at` integer,
	`purge_queued_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_runtime_observations_server_runtime_idx` ON `agent_runtime_observations` (`server_id`,`runtime_id`);--> statement-breakpoint
CREATE INDEX `agent_runtime_observations_server_idx` ON `agent_runtime_observations` (`server_id`);--> statement-breakpoint
CREATE INDEX `agent_runtime_observations_cleanup_idx` ON `agent_runtime_observations` (`cleanup_queued_at`);--> statement-breakpoint
CREATE INDEX `agent_runtime_observations_purge_idx` ON `agent_runtime_observations` (`purge_queued_at`);--> statement-breakpoint
CREATE TABLE `aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`deployment_id` text,
	`previous_deployment_id` text,
	`hostname` text NOT NULL,
	`type` text NOT NULL,
	`branch` text,
	`https` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deployment_id`) REFERENCES `deployments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`previous_deployment_id`) REFERENCES `deployments`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "aliases_type_enum" CHECK("aliases"."type" in ('deployment', 'environment', 'branch'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `aliases_hostname_idx` ON `aliases` (`hostname`);--> statement-breakpoint
CREATE INDEX `aliases_project_idx` ON `aliases` (`project_id`);--> statement-breakpoint
CREATE INDEX `aliases_environment_idx` ON `aliases` (`environment_id`);--> statement-breakpoint
CREATE INDEX `aliases_deployment_idx` ON `aliases` (`deployment_id`);--> statement-breakpoint
CREATE TABLE `allowlist` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "allowlist_type_enum" CHECK("allowlist"."type" in ('email', 'domain', 'pattern'))
);
--> statement-breakpoint
CREATE INDEX `allowlist_type_idx` ON `allowlist` (`type`);--> statement-breakpoint
CREATE UNIQUE INDEX `allowlist_type_value_idx` ON `allowlist` (`type`,lower("value"));--> statement-breakpoint
CREATE TABLE `backup_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`backup_run_id` text NOT NULL,
	`type` text NOT NULL,
	`storage` text NOT NULL,
	`object_key` text NOT NULL,
	`checksum_sha256` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`backup_run_id`) REFERENCES `backup_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "backup_artifacts_type_enum" CHECK("backup_artifacts"."type" in ('manifest', 'volume', 'database')),
	CONSTRAINT "backup_artifacts_storage_enum" CHECK("backup_artifacts"."storage" in ('local', 'remote'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `backup_artifacts_run_object_idx` ON `backup_artifacts` (`backup_run_id`,`object_key`);--> statement-breakpoint
CREATE INDEX `backup_artifacts_run_idx` ON `backup_artifacts` (`backup_run_id`);--> statement-breakpoint
CREATE TABLE `backup_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`project_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`destination_type` text DEFAULT 's3' NOT NULL,
	`schedule` text NOT NULL,
	`destination` text NOT NULL,
	`retention` text NOT NULL,
	`volumes` text DEFAULT '{"mode":"allNamed","names":[]}' NOT NULL,
	`database_dumps` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "backup_configs_destination_type_enum" CHECK("backup_configs"."destination_type" in ('s3'))
);
--> statement-breakpoint
CREATE INDEX `backup_configs_environment_idx` ON `backup_configs` (`environment_id`);--> statement-breakpoint
CREATE INDEX `backup_configs_project_idx` ON `backup_configs` (`project_id`);--> statement-breakpoint
CREATE TABLE `backup_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`deployment_id` text,
	`server_id` text,
	`runtime_id` text NOT NULL,
	`schedule_key` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`manifest` text,
	`error_message` text,
	`started_at` integer,
	`finished_at` integer,
	`cleanup_queued_at` integer,
	`cleanup_finished_at` integer,
	`cleanup_error_message` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deployment_id`) REFERENCES `deployments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "backup_runs_status_enum" CHECK("backup_runs"."status" in ('queued', 'running', 'succeeded', 'failed', 'canceled'))
);
--> statement-breakpoint
CREATE INDEX `backup_runs_environment_status_idx` ON `backup_runs` (`environment_id`,`status`);--> statement-breakpoint
CREATE INDEX `backup_runs_project_idx` ON `backup_runs` (`project_id`);--> statement-breakpoint
CREATE INDEX `backup_runs_deployment_idx` ON `backup_runs` (`deployment_id`);--> statement-breakpoint
CREATE INDEX `backup_runs_cleanup_idx` ON `backup_runs` (`cleanup_queued_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `backup_runs_environment_schedule_idx` ON `backup_runs` (`environment_id`,`schedule_key`) WHERE "backup_runs"."schedule_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `backup_runs_active_environment_idx` ON `backup_runs` (`environment_id`) WHERE "backup_runs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE TABLE `deployment_logs` (
	`deployment_id` text NOT NULL,
	`stream` text NOT NULL,
	`seq` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`deployment_id`) REFERENCES `deployments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deployment_logs_seq_idx` ON `deployment_logs` (`deployment_id`,`stream`,`seq`);--> statement-breakpoint
CREATE TABLE `deployments` (
	`id` text PRIMARY KEY NOT NULL,
	`environment_id` text NOT NULL,
	`server_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`phase` text,
	`trigger` text DEFAULT 'user' NOT NULL,
	`github_delivery_id` text,
	`repo_id` integer NOT NULL,
	`repo_full_name` text NOT NULL,
	`git_sha` text NOT NULL,
	`git_branch` text NOT NULL,
	`commit_meta` text DEFAULT '{}' NOT NULL,
	`config` text NOT NULL,
	`env_vars` text NOT NULL,
	`runtime_id` text NOT NULL,
	`error_message` text,
	`started_at` integer,
	`finished_at` integer,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "deployments_status_enum" CHECK("deployments"."status" in ('queued', 'running', 'succeeded', 'failed', 'canceled')),
	CONSTRAINT "deployments_trigger_enum" CHECK("deployments"."trigger" in ('user', 'webhook', 'api', 'rollback'))
);
--> statement-breakpoint
CREATE INDEX `deployments_environment_idx` ON `deployments` (`environment_id`);--> statement-breakpoint
CREATE INDEX `deployments_server_idx` ON `deployments` (`server_id`);--> statement-breakpoint
CREATE INDEX `deployments_status_idx` ON `deployments` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `deployments_running_runtime_idx` ON `deployments` (`runtime_id`) WHERE "deployments"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX `deployments_github_delivery_environment_idx` ON `deployments` (`github_delivery_id`,`environment_id`) WHERE "deployments"."github_delivery_id" is not null;--> statement-breakpoint
CREATE TABLE `domains` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`hostname` text NOT NULL,
	`base_path` text,
	`https` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`message` text,
	`verified_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "domains_status_enum" CHECK("domains"."status" in ('pending', 'active', 'disabled', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domains_hostname_idx` ON `domains` (`hostname`);--> statement-breakpoint
CREATE INDEX `domains_project_idx` ON `domains` (`project_id`);--> statement-breakpoint
CREATE INDEX `domains_environment_idx` ON `domains` (`environment_id`);--> statement-breakpoint
CREATE TABLE `environments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`server_id` text,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`branch` text NOT NULL,
	`is_production` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`color` text DEFAULT 'blue' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`runtime_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "environments_status_enum" CHECK("environments"."status" in ('active', 'deleted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `environments_project_slug_idx` ON `environments` (`project_id`,`slug`);--> statement-breakpoint
CREATE INDEX `environments_server_idx` ON `environments` (`server_id`);--> statement-breakpoint
CREATE TABLE `github_installations` (
	`installation_id` integer PRIMARY KEY NOT NULL,
	`account_id` integer,
	`account_login` text NOT NULL,
	`account_type` text NOT NULL,
	`repository_selection` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "github_installations_status_enum" CHECK("github_installations"."status" in ('active', 'deleted', 'suspended'))
);
--> statement-breakpoint
CREATE INDEX `github_installations_account_id_idx` ON `github_installations` (`account_id`);--> statement-breakpoint
CREATE INDEX `github_installations_account_idx` ON `github_installations` (`account_login`);--> statement-breakpoint
CREATE INDEX `github_installations_status_idx` ON `github_installations` (`status`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`github_repo_id` integer,
	`github_repo` text NOT NULL,
	`github_installation_id` integer,
	`default_server_id` text,
	`avatar_path` text,
	`routes` text,
	`env_vars_encrypted` text,
	`runtime_config` text DEFAULT '{"type":"compose","path":null,"releaseCommand":null,"releaseService":null,"readinessPath":null,"deployCommand":null,"rollbackCommand":null,"timeoutSeconds":1800}' NOT NULL,
	`compose_metadata` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`github_installation_id`) REFERENCES `github_installations`(`installation_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`default_server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "projects_status_enum" CHECK("projects"."status" in ('active', 'deleted', 'banned'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_team_slug_idx` ON `projects` (`team_id`,lower("slug")) WHERE "projects"."status" <> 'deleted';--> statement-breakpoint
CREATE INDEX `projects_team_idx` ON `projects` (`team_id`);--> statement-breakpoint
CREATE INDEX `projects_github_installation_idx` ON `projects` (`github_installation_id`);--> statement-breakpoint
CREATE INDEX `projects_default_server_idx` ON `projects` (`default_server_id`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`reset_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runtime_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`runtime_id` text NOT NULL,
	`service` text NOT NULL,
	`observed_at` integer NOT NULL,
	`content` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runtime_logs_content_idx` ON `runtime_logs` (`server_id`,`runtime_id`,`content_hash`);--> statement-breakpoint
CREATE INDEX `runtime_logs_runtime_idx` ON `runtime_logs` (`server_id`,`runtime_id`);--> statement-breakpoint
CREATE INDEX `runtime_logs_observed_idx` ON `runtime_logs` (`observed_at`);--> statement-breakpoint
CREATE TABLE `server_availability_windows` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `server_availability_windows_server_started_idx` ON `server_availability_windows` (`server_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `server_heartbeats` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`observed_at` integer NOT NULL,
	`agent_version` text,
	`public_address` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `server_heartbeats_server_observed_idx` ON `server_heartbeats` (`server_id`,`observed_at`);--> statement-breakpoint
CREATE INDEX `server_heartbeats_observed_idx` ON `server_heartbeats` (`observed_at`);--> statement-breakpoint
CREATE TABLE `server_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`observed_at` integer NOT NULL,
	`cpu_percent` real,
	`load_1` real,
	`memory_used_bytes` integer,
	`memory_total_bytes` integer,
	`disk_used_bytes` integer,
	`disk_total_bytes` integer,
	`network_receive_bytes_per_second` real,
	`network_transmit_bytes_per_second` real,
	`disk_read_bytes_per_second` real,
	`disk_write_bytes_per_second` real,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `server_metrics_server_observed_idx` ON `server_metrics` (`server_id`,`observed_at`);--> statement-breakpoint
CREATE INDEX `server_metrics_observed_idx` ON `server_metrics` (`observed_at`);--> statement-breakpoint
CREATE TABLE `servers` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	`handle` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`agent_version` text,
	`agent_protocol_version` integer,
	`agent_capabilities` text,
	`public_address` text,
	`hostname` text,
	`operating_system` text,
	`kernel_version` text,
	`architecture` text,
	`cpu_core_count` integer,
	`host_uptime_seconds` integer,
	`enrollment_token_hash` text,
	`enrollment_token_expires_at` integer,
	`agent_credential_hash` text,
	`pending_agent_credential_hash` text,
	`agent_credential_rotated_at` integer,
	`last_seen_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "servers_status_enum" CHECK("servers"."status" in ('pending', 'connected', 'disconnected', 'disabled', 'deleted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `servers_team_handle_idx` ON `servers` (`team_id`,`handle`) WHERE "servers"."status" <> 'deleted';--> statement-breakpoint
CREATE UNIQUE INDEX `servers_team_name_idx` ON `servers` (`team_id`,lower("name")) WHERE "servers"."status" <> 'deleted';--> statement-breakpoint
CREATE INDEX `servers_team_idx` ON `servers` (`team_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `team_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`inviter_id` text,
	`token_hash` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "team_invites_role_enum" CHECK("team_invites"."role" in ('owner', 'admin', 'member')),
	CONSTRAINT "team_invites_status_enum" CHECK("team_invites"."status" in ('pending', 'accepted', 'revoked', 'expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_invites_token_hash_idx` ON `team_invites` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `team_invites_pending_email_idx` ON `team_invites` (`team_id`,lower("email")) WHERE "team_invites"."status" = 'pending';--> statement-breakpoint
CREATE INDEX `team_invites_team_idx` ON `team_invites` (`team_id`);--> statement-breakpoint
CREATE INDEX `team_invites_email_idx` ON `team_invites` (lower("email"));--> statement-breakpoint
CREATE TABLE `team_members` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "team_members_role_enum" CHECK("team_members"."role" in ('owner', 'admin', 'member'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_members_team_user_idx` ON `team_members` (`team_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `team_members_user_idx` ON `team_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `team_members_team_idx` ON `team_members` (`team_id`);--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`avatar_path` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "teams_status_enum" CHECK("teams"."status" in ('active', 'deleted', 'banned'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teams_slug_idx` ON `teams` (`slug`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`username` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`image` text,
	`default_team_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`default_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "user_status_enum" CHECK("user"."status" in ('active', 'deleted', 'banned'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_username_idx` ON `user` (lower("username")) WHERE status = 'active';--> statement-breakpoint
CREATE TABLE `user_cleanup_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`payload` text NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`error_message` text,
	`claimed_at` integer,
	`available_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`finished_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_cleanup_jobs_status_enum" CHECK("user_cleanup_jobs"."status" in ('queued', 'running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `user_cleanup_jobs_status_available_idx` ON `user_cleanup_jobs` (`status`,`available_at`);--> statement-breakpoint
CREATE INDEX `user_cleanup_jobs_user_idx` ON `user_cleanup_jobs` (`user_id`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);