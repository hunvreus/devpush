UPDATE "backup_configs"
SET "retention" = jsonb_build_object(
  'local',
  jsonb_build_object(
    'count',
    CASE
      WHEN jsonb_typeof("retention" -> 'local' -> 'count') = 'number'
        THEN ("retention" -> 'local' ->> 'count')::integer
      WHEN jsonb_typeof("retention" -> 'count') = 'number'
        THEN ("retention" ->> 'count')::integer
      WHEN jsonb_typeof("retention" -> 'daily') = 'number'
        THEN ("retention" ->> 'daily')::integer
      ELSE 7
    END,
    'days',
    CASE
      WHEN jsonb_typeof("retention" -> 'local' -> 'days') = 'number'
        THEN ("retention" -> 'local' ->> 'days')::integer
      WHEN jsonb_typeof("retention" -> 'days') = 'number'
        THEN ("retention" ->> 'days')::integer
      ELSE 0
    END,
    'maxStorageGb',
    CASE
      WHEN jsonb_typeof("retention" -> 'local' -> 'maxStorageGb') = 'number'
        THEN ("retention" -> 'local' ->> 'maxStorageGb')::numeric
      ELSE 0
    END
  ),
  'remote',
  jsonb_build_object(
    'enabled',
    CASE
      WHEN jsonb_typeof("retention" -> 'remote' -> 'enabled') = 'boolean'
        THEN ("retention" -> 'remote' ->> 'enabled')::boolean
      ELSE false
    END,
    'count',
    CASE
      WHEN jsonb_typeof("retention" -> 'remote' -> 'count') = 'number'
        THEN ("retention" -> 'remote' ->> 'count')::integer
      WHEN jsonb_typeof("retention" -> 'count') = 'number'
        THEN ("retention" ->> 'count')::integer
      WHEN jsonb_typeof("retention" -> 'daily') = 'number'
        THEN ("retention" ->> 'daily')::integer
      ELSE 7
    END,
    'days',
    CASE
      WHEN jsonb_typeof("retention" -> 'remote' -> 'days') = 'number'
        THEN ("retention" -> 'remote' ->> 'days')::integer
      WHEN jsonb_typeof("retention" -> 'days') = 'number'
        THEN ("retention" ->> 'days')::integer
      ELSE 0
    END,
    'maxStorageGb',
    CASE
      WHEN jsonb_typeof("retention" -> 'remote' -> 'maxStorageGb') = 'number'
        THEN ("retention" -> 'remote' ->> 'maxStorageGb')::numeric
      ELSE 0
    END
  )
),
"updated_at" = now()
WHERE NOT ("retention" ? 'local' AND "retention" ? 'remote');
