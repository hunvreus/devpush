import { describe, expect, test } from 'vitest'

import { filterDeployments, isWithinDatePreset } from './deployment-filters'

const now = new Date('2026-08-22T12:00:00.000Z')
const deployments = [
  {
    createdAt: '2026-08-22T11:00:00.000Z',
    environmentSlug: 'production',
    gitBranch: 'main',
    status: 'succeeded',
  },
  {
    createdAt: '2026-08-10T11:00:00.000Z',
    environmentSlug: 'staging',
    gitBranch: 'develop',
    status: 'failed',
  },
]

describe('deployment filters', () => {
  test('combines environment, branch, status, and date filters', () => {
    expect(
      filterDeployments(
        deployments,
        {
          branch: 'main',
          date: '24h',
          environment: 'production',
          status: 'succeeded',
        },
        now,
      ),
    ).toEqual([deployments[0]])
  })

  test('uses the local calendar day for the today preset', () => {
    const localNow = new Date(2026, 7, 22, 12)
    const localToday = new Date(2026, 7, 22, 0).toISOString()
    const localYesterday = new Date(2026, 7, 21, 23, 59, 59).toISOString()

    expect(isWithinDatePreset(localToday, 'today', localNow)).toBe(true)
    expect(isWithinDatePreset(localYesterday, 'today', localNow)).toBe(false)
  })

  test('leaves unknown date presets unfiltered', () => {
    expect(isWithinDatePreset('2020-01-01T00:00:00.000Z', 'all', now)).toBe(
      true,
    )
  })
})
