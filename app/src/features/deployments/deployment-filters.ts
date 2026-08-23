export type DeploymentsSearch = {
  branch?: string
  date?: string
  environment?: string
  status?: string
}

type FilterableDeployment = {
  createdAt: string
  environmentSlug: string
  gitBranch: string | null
  status: string
}

export function filterDeployments<T extends FilterableDeployment>(
  deployments: Array<T>,
  filters: DeploymentsSearch,
  now = new Date(),
) {
  return deployments.filter((deployment) => {
    if (
      filters.environment &&
      deployment.environmentSlug !== filters.environment
    ) {
      return false
    }

    if (filters.status && deployment.status !== filters.status) {
      return false
    }

    if (filters.branch && deployment.gitBranch !== filters.branch) {
      return false
    }

    return (
      !filters.date ||
      isWithinDatePreset(deployment.createdAt, filters.date, now)
    )
  })
}

export function isWithinDatePreset(
  value: string,
  preset: string,
  now = new Date(),
) {
  const date = new Date(value)

  if (preset === 'today') {
    return date >= new Date(now.getFullYear(), now.getMonth(), now.getDate())
  }

  const hours =
    preset === '24h'
      ? 24
      : preset === '7d'
        ? 24 * 7
        : preset === '30d'
          ? 24 * 30
          : null

  return (
    hours == null || date.getTime() >= now.getTime() - hours * 60 * 60 * 1000
  )
}
