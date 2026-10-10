import { describe, expect, test } from 'vitest'

import { parseAvatarDataUrl } from './avatar'

function dataUrl(type: string, bytes: Array<number>) {
  return `data:${type};base64,${Buffer.from(bytes).toString('base64')}`
}

describe('avatar uploads', () => {
  test.each([
    ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'png'],
    ['image/jpeg', [0xff, 0xd8, 0xff, 0xdb], 'jpg'],
    [
      'image/webp',
      [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
      'webp',
    ],
  ])('accepts a valid %s signature', (type, bytes, extension) => {
    expect(parseAvatarDataUrl(dataUrl(type, bytes)).extension).toBe(extension)
  })

  test('rejects a mismatched image signature', () => {
    expect(() =>
      parseAvatarDataUrl(dataUrl('image/png', [0x47, 0x49, 0x46])),
    ).toThrow('does not match')
  })

  test('rejects animated GIF uploads', () => {
    expect(() =>
      parseAvatarDataUrl(dataUrl('image/gif', [0x47, 0x49, 0x46])),
    ).toThrow('PNG, JPEG, or WebP')
  })
})
