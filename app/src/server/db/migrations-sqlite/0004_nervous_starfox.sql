ALTER TABLE `backup_runs` ADD `config_id` text;
--> statement-breakpoint
UPDATE backup_runs SET config_id = coalesce(
  json_extract(manifest, '$.backupConfigId'),
  (SELECT min(id) FROM backup_configs WHERE environment_id = backup_runs.environment_id HAVING count(*) = 1)
);
