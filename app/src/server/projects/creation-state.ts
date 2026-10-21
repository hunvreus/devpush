import { sql } from 'drizzle-orm'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import type { AtomicStore } from '@/server/db/atomic'
import * as schema from '@/server/db/schema'
import type { ApiMutationAdmission } from '@/server/api/admission'
import { createComposeRuntimeConfig } from '@/lib/project-runtime-config'

export async function insertProject(
  store: Pick<BaseSQLiteDatabase<'async', unknown, typeof schema>, 'insert'> &
    AtomicStore,
  input: {
    project: typeof schema.projects.$inferInsert
    environment: typeof schema.environments.$inferInsert
    hostname: string | null
    https: boolean
    userId?: string
    admission?: ApiMutationAdmission
  },
) {
  const p = input.project
  const e = input.environment
  const created = sql`exists(select 1 from ${schema.projects} where id = ${p.id})`
  const actor = input.userId
    ? sql`exists(select 1 from ${schema.teamMembers} m join ${schema.user} u on u.id = m.user_id join ${schema.teams} t on t.id = m.team_id where m.user_id = ${input.userId} and m.team_id = ${p.teamId} and u.status = 'active' and t.status = 'active')`
    : sql`1`
  const [inserted] = await store.batch([
    store.all(sql`insert into ${schema.projects}
      (id,team_id,slug,name,status,github_repo_id,github_repo,github_installation_id,default_server_id,routes,env_vars_encrypted,runtime_config,compose_metadata)
      select ${p.id},${p.teamId},${p.slug},${p.name},'active',${p.githubRepoId ?? null},${p.githubRepo},${p.githubInstallationId ?? null},${p.defaultServerId ?? null},${p.routes == null ? null : JSON.stringify(p.routes)},${p.envVarsEncrypted ?? null},${JSON.stringify(p.runtimeConfig ?? createComposeRuntimeConfig())},${p.composeMetadata == null ? null : JSON.stringify(p.composeMetadata)}
      where ${created} or (${actor} and ${input.admission?.guard ?? sql`1`} and (${p.defaultServerId ?? null} is null or exists(select 1 from ${schema.servers} where id = ${p.defaultServerId ?? null} and team_id = ${p.teamId} and status <> 'deleted'))) returning id`),
    store.run(sql`insert into ${schema.environments} (id,project_id,server_id,name,slug,branch,is_production,position,color,status,runtime_id)
      select ${e.id},${e.projectId},${e.serverId ?? null},${e.name},${e.slug},${e.branch},${Number(e.isProduction ?? false)},${e.position ?? 0},${e.color ?? 'blue'},${e.status ?? 'active'},${e.runtimeId} where ${created}`),
    ...(input.hostname
      ? [
          store.run(sql`insert into aliases
      (id, project_id, environment_id, hostname, type, https)
      select ${crypto.randomUUID()}, ${input.project.id}, ${input.environment.id},
        case when exists(select 1 from domains where hostname = ${input.hostname})
          then null else ${input.hostname} end,
        'environment', ${Number(input.https)} where ${created}`),
        ]
      : []),
    ...(input.admission?.statements ?? []),
  ])
  return inserted.length === 1
}
