CREATE TABLE `backup_storage` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	`bucket` text NOT NULL,
	`region` text NOT NULL,
	`endpoint` text,
	`access_key_id` text NOT NULL,
	`secret_access_key_ciphertext` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `backup_storage_team_idx` ON `backup_storage` (`team_id`);--> statement-breakpoint
ALTER TABLE `backup_runs` ADD `destination` text;
--> statement-breakpoint
-- Preserve the destination actually dispatched, independently of policy edits.
UPDATE backup_runs SET destination = (
  SELECT json_extract(job.payload, '$.destination') FROM agent_jobs AS job
  WHERE job.type = 'backup' AND json_extract(job.payload, '$.backupRunId') = backup_runs.id
    AND json_extract(job.payload, '$.retention.remote.enabled') = 1
  ORDER BY job.created_at DESC LIMIT 1
);
--> statement-breakpoint
-- Promote existing credential-bearing policy connections into workspace storage.
INSERT INTO backup_storage (id, team_id, name, bucket, region, endpoint, access_key_id, secret_access_key_ciphertext, created_at, updated_at)
SELECT 'migrated-' || min(config.id), project.team_id, min(config.name) || ' storage',
  json_extract(config.destination, '$.bucket'), coalesce(json_extract(config.destination, '$.region'), 'auto'),
  nullif(json_extract(config.destination, '$.endpoint'), ''), json_extract(config.destination, '$.accessKeyId'),
  json_extract(config.destination, '$.secretAccessKeyCiphertext'), min(config.created_at), max(config.updated_at)
FROM backup_configs AS config JOIN projects AS project ON project.id = config.project_id
WHERE nullif(json_extract(config.destination, '$.accessKeyId'), '') IS NOT NULL
  AND nullif(json_extract(config.destination, '$.secretAccessKeyCiphertext'), '') IS NOT NULL
GROUP BY project.team_id, json_extract(config.destination, '$.bucket'), coalesce(json_extract(config.destination, '$.region'), 'auto'),
  nullif(json_extract(config.destination, '$.endpoint'), ''), json_extract(config.destination, '$.accessKeyId'), json_extract(config.destination, '$.secretAccessKeyCiphertext');
--> statement-breakpoint
-- Recover connections for old runs even when the policy now uses another bucket.
INSERT INTO backup_storage (id, team_id, name, bucket, region, endpoint, access_key_id, secret_access_key_ciphertext, created_at, updated_at)
SELECT 'recovered-' || min(run.id), project.team_id, 'Recovered ' || json_extract(run.destination, '$.bucket'),
  json_extract(run.destination, '$.bucket'), coalesce(json_extract(run.destination, '$.region'), 'auto'),
  nullif(json_extract(run.destination, '$.endpoint'), ''), json_extract(run.destination, '$.accessKeyId'),
  json_extract(run.destination, '$.secretAccessKeyCiphertext'), min(run.created_at), max(run.updated_at)
FROM backup_runs AS run JOIN projects AS project ON project.id = run.project_id
WHERE run.destination IS NOT NULL
  AND nullif(json_extract(run.destination, '$.accessKeyId'), '') IS NOT NULL
  AND nullif(json_extract(run.destination, '$.secretAccessKeyCiphertext'), '') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM backup_storage AS storage WHERE storage.team_id = project.team_id
    AND storage.bucket = json_extract(run.destination, '$.bucket')
    AND storage.region = coalesce(json_extract(run.destination, '$.region'), 'auto')
    AND coalesce(storage.endpoint, '') = coalesce(json_extract(run.destination, '$.endpoint'), '')
    AND storage.access_key_id = json_extract(run.destination, '$.accessKeyId')
    AND storage.secret_access_key_ciphertext = json_extract(run.destination, '$.secretAccessKeyCiphertext'))
GROUP BY project.team_id, json_extract(run.destination, '$.bucket'), coalesce(json_extract(run.destination, '$.region'), 'auto'),
  nullif(json_extract(run.destination, '$.endpoint'), ''), json_extract(run.destination, '$.accessKeyId'), json_extract(run.destination, '$.secretAccessKeyCiphertext');
--> statement-breakpoint
UPDATE backup_runs SET destination = json_patch(destination,
  coalesce((SELECT json_object('storageId', storage.id) FROM backup_storage AS storage JOIN projects AS project ON project.id = backup_runs.project_id
    WHERE storage.team_id = project.team_id
      AND storage.bucket = json_extract(backup_runs.destination, '$.bucket')
      AND storage.region = coalesce(json_extract(backup_runs.destination, '$.region'), 'auto')
      AND coalesce(storage.endpoint, '') = coalesce(json_extract(backup_runs.destination, '$.endpoint'), '')
      AND storage.access_key_id = json_extract(backup_runs.destination, '$.accessKeyId')
      AND storage.secret_access_key_ciphertext = json_extract(backup_runs.destination, '$.secretAccessKeyCiphertext') LIMIT 1), '{}')
) WHERE destination IS NOT NULL;
--> statement-breakpoint
UPDATE backup_configs SET destination = json_patch(
  json_object('prefix', coalesce(json_extract(destination, '$.prefix'), '')),
  coalesce((SELECT json_object('storageId', storage.id) FROM backup_storage AS storage JOIN projects AS project ON project.id = backup_configs.project_id
    WHERE storage.team_id = project.team_id
      AND storage.bucket = json_extract(backup_configs.destination, '$.bucket')
      AND storage.region = coalesce(json_extract(backup_configs.destination, '$.region'), 'auto')
      AND coalesce(storage.endpoint, '') = coalesce(json_extract(backup_configs.destination, '$.endpoint'), '')
      AND storage.access_key_id = json_extract(backup_configs.destination, '$.accessKeyId')
      AND storage.secret_access_key_ciphertext = json_extract(backup_configs.destination, '$.secretAccessKeyCiphertext') LIMIT 1), '{}')
);
