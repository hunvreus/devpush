// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { ProfilePicture } from './profile-picture'

test('picture removal can be undone before saving and controls lock during processing', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const onFile = vi.fn(async () => {})
  function Example({ processing = false }: { processing?: boolean }) {
    const [image, setImage] = useState<string | null>(
      'https://example.test/picture.png',
    )
    return (
      <ProfilePicture
        image={image}
        name="Ronan"
        email="ronan@example.test"
        disabled={false}
        processing={processing}
        onFile={onFile}
        onChange={setImage}
      />
    )
  }
  try {
    await act(async () => root.render(<Example />))
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[aria-label="Remove picture"]')!
        .click(),
    )
    expect(host.querySelector('[aria-label="Reset picture"]')).not.toBeNull()
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[aria-label="Reset picture"]')!
        .click(),
    )
    expect(host.querySelector('[aria-label="Remove picture"]')).not.toBeNull()
    await act(async () => root.render(<Example processing />))
    expect(
      host.querySelector<HTMLButtonElement>(
        '[aria-label="Upload profile picture"]',
      )!.disabled,
    ).toBe(true)
    expect(
      host.querySelector<HTMLButtonElement>('[aria-label="Remove picture"]')!
        .disabled,
    ).toBe(true)
  } finally {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  }
})
