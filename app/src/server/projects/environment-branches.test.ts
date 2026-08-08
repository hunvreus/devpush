import { describe, expect, test } from 'vitest'

import {
  getEnvironmentForBranch,
  groupBranchesByEnvironment,
} from './environment-branches'

const environments = [
  { id: 'production', branch: 'main' },
  { id: 'staging', branch: 'stg-*' },
  { id: 'preview', branch: '*' },
]

describe('environment branch matching', () => {
  test('assigns a branch to only the first matching environment', () => {
    expect(getEnvironmentForBranch('main', environments)?.id).toBe('production')
    expect(getEnvironmentForBranch('stg-feature', environments)?.id).toBe(
      'staging',
    )
    expect(getEnvironmentForBranch('feature/test', environments)?.id).toBe(
      'preview',
    )
  })

  test('does not apply wildcard matching to the production environment', () => {
    expect(
      getEnvironmentForBranch('main', [
        { id: 'production', branch: '*' },
        { id: 'preview', branch: 'main' },
      ])?.id,
    ).toBe('preview')
  })

  test('groups each repository branch under at most one environment', () => {
    expect(
      Object.fromEntries(
        groupBranchesByEnvironment(environments, [
          'main',
          'stg-one',
          'stg-two',
          'feature/test',
        ]),
      ),
    ).toEqual({
      production: ['main'],
      staging: ['stg-one', 'stg-two'],
      preview: ['feature/test'],
    })
  })

  test('leaves unmatched branches unassigned', () => {
    expect(
      getEnvironmentForBranch('feature/test', environments.slice(0, 2)),
    ).toBeNull()
  })
})
