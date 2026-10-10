import { describe, expect, test } from 'vitest'

import { normalizeS3Destination } from './service'

describe('backup destinations', () => {
  test('rejects parent traversal in remote prefixes', () => {
    expect(() =>
      normalizeS3Destination({
        bucket: 'devpush-backups',
        prefix: 'projects/../other',
      }),
    ).toThrow('Backup destination prefixes cannot contain .. segments.')
  })
})
