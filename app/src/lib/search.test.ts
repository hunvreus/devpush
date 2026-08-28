import { describe, expect, it } from 'vitest'

import { stringSearchValidator } from './search'

describe('stringSearchValidator', () => {
  const validate = stringSearchValidator(['branch', 'status'] as const)

  it('keeps configured string values', () => {
    expect(validate({ branch: 'main', status: '' })).toEqual({
      branch: 'main',
      status: '',
    })
  })

  it('drops unknown keys and non-string values', () => {
    expect(
      validate({
        branch: ['main'],
        page: '2',
        status: 200,
      }),
    ).toEqual({})
  })
})
