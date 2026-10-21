ALTER TABLE `user` ADD `profile_confirmed_at` integer;--> statement-breakpoint
UPDATE `user` SET `profile_confirmed_at` = `created_at`;
