import { backupDatabaseSchema } from '#devpush/lib/backup-database'
import type { BackupDatabase } from '#devpush/lib/backup-database'

function quote(value: string) {
  return "'" + value.replaceAll("'", "'\\''") + "'"
}
export function buildDatabaseBackupCommand(value: BackupDatabase) {
  const target = backupDatabaseSchema.parse(value)
  const name = quote(target.database)
  switch (target.engine) {
    case 'postgres': {
      const flags =
        'pg_dump --clean --if-exists --no-owner --no-acl -U "${POSTGRES_USER:-postgres}"'
      const dump = target.database
        ? `${flags} --dbname=${name}`
        : `databases="$(psql -v ON_ERROR_STOP=1 -U "\${POSTGRES_USER:-postgres}" --dbname=postgres -Atc "SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY datname")" || exit $?; printf '%s\\n' "$databases" | while IFS= read -r database; do ${flags} --create --dbname="$database" || exit $?; done`
      return `export PGPASSWORD="\${POSTGRES_PASSWORD:-}"; ${dump}`
    }
    case 'mysql':
      return `export MYSQL_PWD="\${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD is required}"; mysqldump -u root --single-transaction --quick --no-tablespaces ${target.database ? `--databases -- ${name}` : '--all-databases'}`
    case 'mariadb':
      return `export MYSQL_PWD="\${MARIADB_ROOT_PASSWORD:-\${MYSQL_ROOT_PASSWORD:?A root password is required}}"; mariadb-dump -u root --single-transaction --quick ${target.database ? `--databases -- ${name}` : '--all-databases'}`
    case 'mongo':
      return `mongodump --username="\${MONGO_INITDB_ROOT_USERNAME:?MongoDB username is required}" --password="\${MONGO_INITDB_ROOT_PASSWORD:?MongoDB password is required}" --authenticationDatabase=admin --archive${target.database ? ` --db=${name}` : ''}`
  }
}
export function buildDatabaseRestoreCommand(value: BackupDatabase) {
  const target = backupDatabaseSchema.parse(value)
  const name = quote(target.database)
  switch (target.engine) {
    case 'postgres':
      return `export PGPASSWORD="\${POSTGRES_PASSWORD:-}"; psql -v ON_ERROR_STOP=1 -U "\${POSTGRES_USER:-postgres}" --dbname=${target.database ? name : 'template1'}`
    case 'mysql':
      return 'export MYSQL_PWD="${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD is required}"; mysql -u root'
    case 'mariadb':
      return 'export MYSQL_PWD="${MARIADB_ROOT_PASSWORD:-${MYSQL_ROOT_PASSWORD:?A root password is required}}"; mariadb -u root'
    case 'mongo':
      return 'mongorestore --username="${MONGO_INITDB_ROOT_USERNAME:?MongoDB username is required}" --password="${MONGO_INITDB_ROOT_PASSWORD:?MongoDB password is required}" --authenticationDatabase=admin --archive --drop'
  }
}
