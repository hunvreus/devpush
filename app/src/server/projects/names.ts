import { and, eq, ne, sql } from 'drizzle-orm'

import type { db } from '@/server/db'
import { projects } from '@/server/db/schema'

const projectMachineNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$/
const projectMachineNameError =
  'Project names can only contain letters, numbers, hyphens, underscores and dots. They cannot start or end with a dot, underscore or hyphen.'

export function validateProjectMachineName(name: string) {
  if (
    name.length === 0 ||
    name.length > 100 ||
    !projectMachineNamePattern.test(name)
  ) {
    throw new Error(projectMachineNameError)
  }
}

export async function requireAvailableProjectMachineName(
  tx: Pick<typeof db, 'select'>,
  teamId: string,
  slug: string,
  projectId?: string,
) {
  const duplicateRows = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.teamId, teamId),
        sql`lower(${projects.slug}) = lower(${slug})`,
        ne(projects.status, 'deleted'),
        projectId ? ne(projects.id, projectId) : undefined,
      ),
    )
    .limit(1)

  if (duplicateRows.at(0)) {
    throw new Error('Project names must be unique within a team.')
  }
}
