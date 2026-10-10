-- Old pg_dumpall archives include cluster roles and cannot use the new generated restore safely.
UPDATE backup_runs
SET manifest = json_set(manifest, '$.databaseTargets', json((
  SELECT json_group_array(json(CASE
    WHEN json_extract(target.value, '$.engine') = 'postgres'
      AND json_extract(job.payload, '$.databaseDumps[' || target.key || '].command') IN
        ('pg_dumpall -U "$POSTGRES_USER"', 'pg_dumpall -U "$POSTGRES_USER" | gzip')
    THEN json_set(target.value, '$.engine', 'needs_configuration', '$.legacyCommand',
      json_extract(job.payload, '$.databaseDumps[' || target.key || '].command'))
    ELSE target.value END))
  FROM json_each(manifest, '$.databaseTargets') AS target
)))
FROM agent_jobs AS job
WHERE job.type = 'backup'
  AND json_extract(job.payload, '$.backupRunId') = backup_runs.id
  AND json_type(manifest, '$.databaseTargets') = 'array';
