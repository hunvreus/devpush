CREATE TYPE "public"."agent_job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'canceled', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."agent_job_type" AS ENUM('deploy', 'deprovision', 'purge', 'backup', 'restore', 'backup_cleanup');--> statement-breakpoint
CREATE TYPE "public"."alias_type" AS ENUM('deployment', 'environment', 'branch');--> statement-breakpoint
CREATE TYPE "public"."allowlist_type" AS ENUM('email', 'domain', 'pattern');--> statement-breakpoint
CREATE TYPE "public"."backup_artifact_storage" AS ENUM('local', 'remote');--> statement-breakpoint
CREATE TYPE "public"."backup_artifact_type" AS ENUM('manifest', 'volume', 'database');--> statement-breakpoint
CREATE TYPE "public"."backup_destination_type" AS ENUM('s3');--> statement-breakpoint
CREATE TYPE "public"."backup_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."deployment_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."deployment_trigger" AS ENUM('user', 'webhook', 'api', 'rollback');--> statement-breakpoint
CREATE TYPE "public"."domain_status" AS ENUM('pending', 'active', 'disabled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."environment_status" AS ENUM('active', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."github_installation_status" AS ENUM('active', 'deleted', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."resource_status" AS ENUM('active', 'deleted', 'banned');--> statement-breakpoint
CREATE TYPE "public"."server_status" AS ENUM('pending', 'connected', 'disconnected', 'disabled', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."team_invite_status" AS ENUM('pending', 'accepted', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."team_member_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."user_cleanup_job_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"provider_account_name" text,
	"provider_account_email" text,
	"provider_account_username" text,
	"provider_account_image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "agent_job_type" NOT NULL,
	"status" "agent_job_status" DEFAULT 'queued' NOT NULL,
	"server_id" text NOT NULL,
	"team_id" text,
	"project_id" text,
	"payload" jsonb NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"error_message" text,
	"claimed_at" timestamp with time zone,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runtime_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"runtime_id" text NOT NULL,
	"services" jsonb,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"cleanup_queued_at" timestamp with time zone,
	"purge_queued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aliases" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"deployment_id" text,
	"previous_deployment_id" text,
	"hostname" text NOT NULL,
	"type" "alias_type" NOT NULL,
	"branch" text,
	"https" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "allowlist" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "allowlist_type" NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"backup_run_id" text NOT NULL,
	"type" "backup_artifact_type" NOT NULL,
	"storage" "backup_artifact_storage" NOT NULL,
	"object_key" text NOT NULL,
	"checksum_sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"project_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"destination_type" "backup_destination_type" DEFAULT 's3' NOT NULL,
	"schedule" jsonb NOT NULL,
	"destination" jsonb NOT NULL,
	"retention" jsonb NOT NULL,
	"volumes" jsonb DEFAULT '{"mode":"allNamed","names":[]}'::jsonb NOT NULL,
	"database_dumps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"deployment_id" text,
	"server_id" text,
	"runtime_id" text NOT NULL,
	"status" "backup_status" DEFAULT 'queued' NOT NULL,
	"manifest" jsonb,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"cleanup_queued_at" timestamp with time zone,
	"cleanup_finished_at" timestamp with time zone,
	"cleanup_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_logs" (
	"deployment_id" text NOT NULL,
	"stream" text NOT NULL,
	"seq" integer NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"server_id" text NOT NULL,
	"status" "deployment_status" DEFAULT 'queued' NOT NULL,
	"phase" text,
	"trigger" "deployment_trigger" DEFAULT 'user' NOT NULL,
	"repo_id" bigint NOT NULL,
	"repo_full_name" text NOT NULL,
	"git_sha" text NOT NULL,
	"git_branch" text NOT NULL,
	"commit_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"config" jsonb NOT NULL,
	"env_vars" text NOT NULL,
	"runtime_id" text NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "environments" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"server_id" text,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"branch" text NOT NULL,
	"is_production" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"color" text DEFAULT 'blue' NOT NULL,
	"status" "environment_status" DEFAULT 'active' NOT NULL,
	"runtime_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_installations" (
	"installation_id" bigint PRIMARY KEY NOT NULL,
	"account_id" bigint,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"repository_selection" text NOT NULL,
	"status" "github_installation_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" "resource_status" DEFAULT 'active' NOT NULL,
	"github_repo_id" bigint,
	"github_repo" text NOT NULL,
	"github_installation_id" bigint,
	"default_server_id" text,
	"avatar_path" text,
	"routes" jsonb,
	"env_vars" jsonb,
	"runtime_config" jsonb DEFAULT '{"type":"compose","path":null,"strategy":"managed","releaseCommand":null,"releaseService":null,"readinessPath":null,"deployCommand":null,"rollbackCommand":null,"timeoutSeconds":1800}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runtime_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"runtime_id" text NOT NULL,
	"service" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_availability_windows" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_heartbeats" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"agent_version" text,
	"public_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"cpu_percent" double precision,
	"load_1" double precision,
	"memory_used_bytes" bigint,
	"memory_total_bytes" bigint,
	"disk_used_bytes" bigint,
	"disk_total_bytes" bigint,
	"network_receive_bytes_per_second" double precision,
	"network_transmit_bytes_per_second" double precision,
	"disk_read_bytes_per_second" double precision,
	"disk_write_bytes_per_second" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "servers" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"handle" text NOT NULL,
	"status" "server_status" DEFAULT 'pending' NOT NULL,
	"agent_version" text,
	"agent_protocol_version" integer,
	"agent_capabilities" jsonb,
	"public_address" text,
	"hostname" text,
	"operating_system" text,
	"kernel_version" text,
	"architecture" text,
	"cpu_core_count" integer,
	"host_uptime_seconds" bigint,
	"enrollment_token_hash" text,
	"enrollment_token_expires_at" timestamp with time zone,
	"agent_credential_hash" text,
	"pending_agent_credential_hash" text,
	"agent_credential_rotated_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "team_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"email" text NOT NULL,
	"role" "team_member_role" DEFAULT 'member' NOT NULL,
	"inviter_id" text,
	"token_hash" text NOT NULL,
	"status" "team_invite_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "team_member_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" "resource_status" DEFAULT 'active' NOT NULL,
	"avatar_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"username" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"status" "resource_status" DEFAULT 'active' NOT NULL,
	"image" text,
	"default_team_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_cleanup_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" "user_cleanup_job_status" DEFAULT 'queued' NOT NULL,
	"payload" jsonb NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"error_message" text,
	"claimed_at" timestamp with time zone,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runtime_observations" ADD CONSTRAINT "agent_runtime_observations_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aliases" ADD CONSTRAINT "aliases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aliases" ADD CONSTRAINT "aliases_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aliases" ADD CONSTRAINT "aliases_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aliases" ADD CONSTRAINT "aliases_previous_deployment_id_deployments_id_fk" FOREIGN KEY ("previous_deployment_id") REFERENCES "public"."deployments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_artifacts" ADD CONSTRAINT "backup_artifacts_backup_run_id_backup_runs_id_fk" FOREIGN KEY ("backup_run_id") REFERENCES "public"."backup_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_configs" ADD CONSTRAINT "backup_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_configs" ADD CONSTRAINT "backup_configs_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_logs" ADD CONSTRAINT "deployment_logs_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_github_installation_id_github_installations_installation_id_fk" FOREIGN KEY ("github_installation_id") REFERENCES "public"."github_installations"("installation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_default_server_id_servers_id_fk" FOREIGN KEY ("default_server_id") REFERENCES "public"."servers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_logs" ADD CONSTRAINT "runtime_logs_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_availability_windows" ADD CONSTRAINT "server_availability_windows_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_heartbeats" ADD CONSTRAINT "server_heartbeats_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_metrics" ADD CONSTRAINT "server_metrics_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_default_team_id_teams_id_fk" FOREIGN KEY ("default_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_cleanup_jobs" ADD CONSTRAINT "user_cleanup_jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_jobs_server_status_idx" ON "agent_jobs" USING btree ("server_id","status");--> statement-breakpoint
CREATE INDEX "agent_jobs_project_idx" ON "agent_jobs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "agent_jobs_team_idx" ON "agent_jobs" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runtime_observations_server_runtime_idx" ON "agent_runtime_observations" USING btree ("server_id","runtime_id");--> statement-breakpoint
CREATE INDEX "agent_runtime_observations_server_idx" ON "agent_runtime_observations" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "agent_runtime_observations_cleanup_idx" ON "agent_runtime_observations" USING btree ("cleanup_queued_at");--> statement-breakpoint
CREATE INDEX "agent_runtime_observations_purge_idx" ON "agent_runtime_observations" USING btree ("purge_queued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "aliases_hostname_idx" ON "aliases" USING btree ("hostname");--> statement-breakpoint
CREATE INDEX "aliases_project_idx" ON "aliases" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "aliases_environment_idx" ON "aliases" USING btree ("environment_id");--> statement-breakpoint
CREATE INDEX "aliases_deployment_idx" ON "aliases" USING btree ("deployment_id");--> statement-breakpoint
CREATE INDEX "allowlist_type_idx" ON "allowlist" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "allowlist_type_value_idx" ON "allowlist" USING btree ("type",lower("value"));--> statement-breakpoint
CREATE UNIQUE INDEX "backup_artifacts_run_object_idx" ON "backup_artifacts" USING btree ("backup_run_id","object_key");--> statement-breakpoint
CREATE INDEX "backup_artifacts_run_idx" ON "backup_artifacts" USING btree ("backup_run_id");--> statement-breakpoint
CREATE INDEX "backup_configs_environment_idx" ON "backup_configs" USING btree ("environment_id");--> statement-breakpoint
CREATE INDEX "backup_configs_project_idx" ON "backup_configs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "backup_runs_environment_status_idx" ON "backup_runs" USING btree ("environment_id","status");--> statement-breakpoint
CREATE INDEX "backup_runs_project_idx" ON "backup_runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "backup_runs_deployment_idx" ON "backup_runs" USING btree ("deployment_id");--> statement-breakpoint
CREATE INDEX "backup_runs_cleanup_idx" ON "backup_runs" USING btree ("cleanup_queued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deployment_logs_seq_idx" ON "deployment_logs" USING btree ("deployment_id","stream","seq");--> statement-breakpoint
CREATE INDEX "deployments_environment_idx" ON "deployments" USING btree ("environment_id");--> statement-breakpoint
CREATE INDEX "deployments_server_idx" ON "deployments" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "deployments_status_idx" ON "deployments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "deployments_running_runtime_idx" ON "deployments" USING btree ("runtime_id") WHERE "deployments"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "domains_hostname_idx" ON "domains" USING btree ("hostname");--> statement-breakpoint
CREATE INDEX "domains_project_idx" ON "domains" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "domains_environment_idx" ON "domains" USING btree ("environment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "environments_project_slug_idx" ON "environments" USING btree ("project_id","slug");--> statement-breakpoint
CREATE INDEX "environments_server_idx" ON "environments" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "github_installations_account_id_idx" ON "github_installations" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "github_installations_account_idx" ON "github_installations" USING btree ("account_login");--> statement-breakpoint
CREATE INDEX "github_installations_status_idx" ON "github_installations" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_team_slug_idx" ON "projects" USING btree ("team_id",lower("slug")) WHERE "projects"."status" <> 'deleted';--> statement-breakpoint
CREATE INDEX "projects_team_idx" ON "projects" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "projects_github_installation_idx" ON "projects" USING btree ("github_installation_id");--> statement-breakpoint
CREATE INDEX "projects_default_server_idx" ON "projects" USING btree ("default_server_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_logs_content_idx" ON "runtime_logs" USING btree ("server_id","runtime_id","content_hash");--> statement-breakpoint
CREATE INDEX "runtime_logs_runtime_idx" ON "runtime_logs" USING btree ("server_id","runtime_id");--> statement-breakpoint
CREATE INDEX "runtime_logs_observed_idx" ON "runtime_logs" USING btree ("observed_at");--> statement-breakpoint
CREATE INDEX "server_availability_windows_server_started_idx" ON "server_availability_windows" USING btree ("server_id","started_at");--> statement-breakpoint
CREATE INDEX "server_heartbeats_server_observed_idx" ON "server_heartbeats" USING btree ("server_id","observed_at");--> statement-breakpoint
CREATE INDEX "server_heartbeats_observed_idx" ON "server_heartbeats" USING btree ("observed_at");--> statement-breakpoint
CREATE INDEX "server_metrics_server_observed_idx" ON "server_metrics" USING btree ("server_id","observed_at");--> statement-breakpoint
CREATE INDEX "server_metrics_observed_idx" ON "server_metrics" USING btree ("observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "servers_team_handle_idx" ON "servers" USING btree ("team_id","handle") WHERE "servers"."status" <> 'deleted';--> statement-breakpoint
CREATE UNIQUE INDEX "servers_team_name_idx" ON "servers" USING btree ("team_id",lower("name")) WHERE "servers"."status" <> 'deleted';--> statement-breakpoint
CREATE INDEX "servers_team_idx" ON "servers" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_invites_token_hash_idx" ON "team_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "team_invites_pending_email_idx" ON "team_invites" USING btree ("team_id",lower("email")) WHERE "team_invites"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "team_invites_team_idx" ON "team_invites" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "team_invites_email_idx" ON "team_invites" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_team_user_idx" ON "team_members" USING btree ("team_id","user_id");--> statement-breakpoint
CREATE INDEX "team_members_user_idx" ON "team_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "team_members_team_idx" ON "team_members" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_slug_idx" ON "teams" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "user_username_idx" ON "user" USING btree (lower("username")) WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "user_cleanup_jobs_status_available_idx" ON "user_cleanup_jobs" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "user_cleanup_jobs_user_idx" ON "user_cleanup_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");