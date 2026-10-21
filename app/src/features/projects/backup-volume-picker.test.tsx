// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { BackupVolumePicker } from './backup-volume-picker'
import type { ProjectBackupConfig } from '@/server/projects/types'

test('multiple volumes accept custom names, retain known values, and remove chips independently', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  HTMLElement.prototype.scrollIntoView = vi.fn()
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  const changed = vi.fn()
  function Form() {
    const [value, setValue] = useState<ProjectBackupConfig['volumes']>({
      mode: 'selected',
      names: ['data'],
    })
    return (
      <BackupVolumePicker
        value={value}
        options={['data', 'uploads']}
        onValueChange={(next) => {
          changed(next)
          setValue(next)
        }}
      />
    )
  }
  try {
    await act(async () => root.render(<Form />))
    const input = node.querySelector<HTMLInputElement>(
      '[aria-label="Compose volumes"]',
    )!
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, 'future_data')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const custom = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((option) => option.textContent.includes('Use “future_data”'))
    expect(custom).toBeDefined()
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        }),
      ),
    )
    expect(changed).toHaveBeenLastCalledWith({
      mode: 'selected',
      names: ['data', 'future_data'],
    })
    expect(input.value).toBe('')
    const chip = node.querySelector('[aria-label="Volume data"]')!
    await act(async () =>
      chip.querySelector<HTMLButtonElement>('button')!.click(),
    )
    expect(changed).toHaveBeenLastCalledWith({
      mode: 'selected',
      names: ['future_data'],
    })
  } finally {
    await act(async () => root.unmount())
    node.remove()
    vi.unstubAllGlobals()
  }
})
