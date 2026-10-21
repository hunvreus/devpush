CREATE TABLE `installation_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`sign_in_message` text DEFAULT '' NOT NULL,
	`settings_version` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "installation_settings_singleton" CHECK("installation_settings"."id" = 1),
	CONSTRAINT "installation_settings_message_length" CHECK(length("installation_settings"."sign_in_message") <= 1000),
	CONSTRAINT "installation_settings_version_positive" CHECK("installation_settings"."settings_version" >= 1)
);
--> statement-breakpoint
INSERT INTO `installation_settings` (`id`) VALUES (1);
