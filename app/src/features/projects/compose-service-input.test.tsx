// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { ComposeServiceInput } from './compose-service-input'

test('service input accepts a name absent from Compose metadata and keeps detected suggestions', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  function Form() {
    const [value, setValue] = useState('')
    return (
      <ComposeServiceInput
        services={['web', 'db']}
        value={value}
        onValueChange={setValue}
        aria-label="Service"
      />
    )
  }
  try {
    await act(async () => root.render(<Form />))
    const input = node.querySelector('input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, 'custom-db')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(input.value).toBe('custom-db')
    expect(input.getAttribute('role')).toBe('combobox')
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      ),
    )
    expect(document.body.textContent).toContain('Use “custom-db”')
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      ),
    )
    expect(input.value).toBe('custom-db')
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, 'd')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const options = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ]
    expect(options.map((option) => option.textContent)).toContain('db')
    expect(options.map((option) => option.textContent)).not.toContain('web')
    await act(async () =>
      options.find((option) => option.textContent === 'db')!.click(),
    )
    expect(input.value).toBe('db')
  } finally {
    await act(async () => root.unmount())
    node.remove()
    vi.unstubAllGlobals()
  }
})
