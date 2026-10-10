ALTER TABLE `deployment_logs` RENAME TO `deployment_events`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_deployment_events` (
	`deployment_id` text NOT NULL,
	`stream` text NOT NULL,
	`seq` integer NOT NULL,
	`content` text NOT NULL,
	`search_content` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`deployment_id`) REFERENCES `deployments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_deployment_events`("deployment_id", "stream", "seq", "content", "search_content", "created_at") SELECT "deployment_id", 'control', "seq", "content", lower("content"), "created_at" FROM `deployment_events`;--> statement-breakpoint
DROP TABLE `deployment_events`;--> statement-breakpoint
ALTER TABLE `__new_deployment_events` RENAME TO `deployment_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `deployment_events_seq_idx` ON `deployment_events` (`deployment_id`,`stream`,`seq`);