ALTER TABLE `backup_configs` ADD `next_check_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `backup_configs_due_idx` ON `backup_configs` (`enabled`,`next_check_at`);
--> statement-breakpoint
CREATE TRIGGER backup_schedule_reset AFTER UPDATE OF schedule, enabled, settings_version ON backup_configs
WHEN NEW.schedule IS NOT OLD.schedule OR NEW.enabled IS NOT OLD.enabled OR NEW.settings_version IS NOT OLD.settings_version
BEGIN
  UPDATE backup_configs SET next_check_at = 0 WHERE id = NEW.id;
END;
