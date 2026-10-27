CREATE TABLE `notification_incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`project_id` text,
	`category` text NOT NULL,
	`source_id` text NOT NULL,
	`revision` text NOT NULL,
	`active` integer NOT NULL,
	`actor_id` text,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`path` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notification_mutes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`team_id` text NOT NULL,
	`project_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notification_mutes_user_scope_idx` ON `notification_mutes` (`user_id`,`team_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `notification_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`incident_id` text NOT NULL,
	`payload` text NOT NULL,
	`revision` text NOT NULL,
	`user_id` text NOT NULL,
	`actor` integer DEFAULT false NOT NULL,
	`recovery` integer NOT NULL,
	`created_at` integer NOT NULL,
	`delivered_at` integer,
	`discarded_at` integer,
	`failed_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer DEFAULT 0 NOT NULL,
	`lease_owner` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`incident_id`) REFERENCES `notification_incidents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_outbox_event_recipient_idx` ON `notification_outbox` (`incident_id`,`revision`,`user_id`,`recovery`);--> statement-breakpoint
CREATE INDEX `notification_outbox_due_idx` ON `notification_outbox` (`delivered_at`,`discarded_at`,`failed_at`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`preferences` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notification_scan_cursors` (
	`source` text PRIMARY KEY NOT NULL,
	`after_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `account_provider_identity_idx` ON `account` (`provider_id`,`account_id`);