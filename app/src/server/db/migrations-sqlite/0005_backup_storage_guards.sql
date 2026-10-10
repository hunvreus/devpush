CREATE TRIGGER backup_configs_storage_insert BEFORE INSERT ON backup_configs
WHEN json_extract(NEW.destination, '$.storageId') IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM backup_storage s JOIN projects p ON p.team_id = s.team_id
WHERE s.id = json_extract(NEW.destination, '$.storageId') AND p.id = NEW.project_id)
BEGIN SELECT RAISE(ABORT, 'Backup storage destination is unavailable in this workspace.'); END;
--> statement-breakpoint
CREATE TRIGGER backup_configs_storage_update BEFORE UPDATE OF destination, project_id ON backup_configs
WHEN json_extract(NEW.destination, '$.storageId') IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM backup_storage s JOIN projects p ON p.team_id = s.team_id
WHERE s.id = json_extract(NEW.destination, '$.storageId') AND p.id = NEW.project_id)
BEGIN SELECT RAISE(ABORT, 'Backup storage destination is unavailable in this workspace.'); END;
--> statement-breakpoint
CREATE TRIGGER backup_runs_storage_insert BEFORE INSERT ON backup_runs
WHEN json_extract(NEW.destination, '$.storageId') IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM backup_storage s JOIN projects p ON p.team_id = s.team_id
WHERE s.id = json_extract(NEW.destination, '$.storageId') AND p.id = NEW.project_id)
BEGIN SELECT RAISE(ABORT, 'Backup storage destination is unavailable in this workspace.'); END;
--> statement-breakpoint
CREATE TRIGGER backup_runs_storage_update BEFORE UPDATE OF destination, project_id ON backup_runs
WHEN json_extract(NEW.destination, '$.storageId') IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM backup_storage s JOIN projects p ON p.team_id = s.team_id
WHERE s.id = json_extract(NEW.destination, '$.storageId') AND p.id = NEW.project_id)
BEGIN SELECT RAISE(ABORT, 'Backup storage destination is unavailable in this workspace.'); END;
--> statement-breakpoint
CREATE TRIGGER backup_storage_referenced_delete BEFORE DELETE ON backup_storage
WHEN EXISTS (SELECT 1 FROM teams WHERE id = OLD.team_id) AND (
EXISTS (SELECT 1 FROM backup_configs WHERE json_extract(destination, '$.storageId') = OLD.id)
OR EXISTS (SELECT 1 FROM backup_runs r WHERE json_extract(r.destination, '$.storageId') = OLD.id
AND (r.status IN ('queued', 'running') OR EXISTS (SELECT 1 FROM backup_artifacts a WHERE a.backup_run_id = r.id AND a.storage = 'remote'))))
BEGIN SELECT RAISE(ABORT, 'Backup storage is still referenced by policies or retained backups.'); END;
