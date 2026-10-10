import { describe, expect, it } from 'vitest'

import { displayNameFromSlug } from './display-name'

describe('displayNameFromSlug', () => {
  it('turns route slugs into stable pending labels', () => {
    expect(displayNameFromSlug('ronan-berder')).toBe('Ronan Berder')
    expect(displayNameFromSlug('platform_ops')).toBe('Platform Ops')
  })
})
