type BranchEnvironment = {
  id: string
  branch: string
  isProduction?: boolean
  slug?: string
}

export function getEnvironmentForBranch<TEnvironment extends BranchEnvironment>(
  branch: string,
  environments: Array<TEnvironment>,
): TEnvironment | null {
  const production =
    environments.find(
      (environment) =>
        environment.isProduction === true || environment.slug === 'production',
    ) ?? environments.at(0)

  if (!production) {
    return null
  }

  if (production.branch === branch) {
    return production
  }

  for (const environment of environments) {
    if (environment.id === production.id) {
      continue
    }
    if (matchesBranchPattern(branch, environment.branch)) {
      return environment
    }
  }

  return null
}

export function groupBranchesByEnvironment<
  TEnvironment extends BranchEnvironment,
>(environments: Array<TEnvironment>, branches: Array<string>) {
  const grouped = new Map(
    environments.map((environment) => [environment.id, [] as Array<string>]),
  )

  for (const branch of branches) {
    const environment = getEnvironmentForBranch(branch, environments)

    if (environment) {
      grouped.get(environment.id)?.push(branch)
    }
  }

  return grouped
}

function matchesBranchPattern(branch: string, pattern: string) {
  if (branch === pattern) {
    return true
  }

  const wildcardIndex = pattern.indexOf('*')

  if (wildcardIndex === -1) {
    return false
  }

  const prefix = pattern.slice(0, wildcardIndex)
  const suffix = pattern.slice(wildcardIndex + 1)

  return (
    branch.length >= prefix.length + suffix.length &&
    branch.startsWith(prefix) &&
    branch.endsWith(suffix)
  )
}
