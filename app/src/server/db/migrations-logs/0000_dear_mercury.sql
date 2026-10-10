CREATE TABLE `deployment_logs` (
	`project_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`deployment_id` text NOT NULL,
	`server_id` text NOT NULL,
	`branch` text NOT NULL,
	`stream` text NOT NULL,
	`seq` integer NOT NULL,
	`content` text NOT NULL,
	`search_content` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deployment_logs_deployment_stream_seq_idx` ON `deployment_logs` (`deployment_id`,`stream`,`seq`);--> statement-breakpoint
CREATE INDEX `deployment_logs_project_time_idx` ON `deployment_logs` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `deployment_logs_project_environment_time_idx` ON `deployment_logs` (`project_id`,`environment_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `runtime_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`server_id` text NOT NULL,
	`runtime_id` text NOT NULL,
	`service` text NOT NULL,
	`observed_at` integer NOT NULL,
	`content` text NOT NULL,
	`search_content` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runtime_logs_hash_idx` ON `runtime_logs` (`server_id`,`runtime_id`,`content_hash`);--> statement-breakpoint
CREATE INDEX `runtime_logs_project_time_idx` ON `runtime_logs` (`project_id`,`observed_at`);--> statement-breakpoint
CREATE INDEX `runtime_logs_server_runtime_time_idx` ON `runtime_logs` (`server_id`,`runtime_id`,`observed_at`);--> statement-breakpoint
CREATE INDEX `runtime_logs_observed_at_idx` ON `runtime_logs` (`observed_at`);