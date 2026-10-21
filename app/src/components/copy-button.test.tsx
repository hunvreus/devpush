// @vitest-environment jsdom
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { CopyButton } from './copy-button'

let root: ReturnType<typeof createRoot> | undefined
let node: HTMLDivElement
async function mount(
  writeText: ReturnType<typeof vi.fn>,
  copy = true,
  control: ReactNode = (
    <CopyButton value="full-path" label="Copy file path" inputGroup />
  ),
) {
  vi.useFakeTimers()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  node = document.createElement('div')
  document.body.append(node)
  root = createRoot(node)
  await act(async () => root!.render(control))
  if (copy)
    await act(async () =>
      node.querySelector<HTMLButtonElement>('button')!.click(),
    )
}
afterEach(async () => {
  await act(async () => root?.unmount())
  node.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
test('confirms successful clipboard write with a check for 1.5 seconds without a tooltip', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  await mount(writeText)
  expect(writeText).toHaveBeenCalledWith('full-path')
  expect(
    node.querySelector('[aria-label="Copied"] svg.lucide-check'),
  ).not.toBeNull()
  expect(document.querySelector('[role="tooltip"]')).toBeNull()
  await act(async () => vi.advanceTimersByTime(1500))
  expect(
    node.querySelector('[aria-label="Copy file path"] svg.lucide-copy'),
  ).not.toBeNull()
})
test('a rejected write never reports Copied', async () => {
  await mount(vi.fn().mockRejectedValue(new Error('denied')))
  expect(node.querySelector('[aria-label="Copied"]')).toBeNull()
  expect(node.querySelector('[aria-label="Unable to copy"]')).not.toBeNull()
  expect(node.querySelector('svg.lucide-copy')).not.toBeNull()
})
test('keeps the accessible field context without a tooltip on focus', async () => {
  await mount(vi.fn(), false)
  await act(async () =>
    node
      .querySelector<HTMLButtonElement>('[aria-label="Copy file path"]')!
      .focus(),
  )
  expect(document.querySelector('[role="tooltip"]')).toBeNull()
  expect(node.querySelector('button')?.hasAttribute('title')).toBe(false)
})

test('uses the compact shadcn input-group button size for field copy actions', async () => {
  await mount(vi.fn(), false)
  const button = node.querySelector<HTMLButtonElement>('button')!
  expect(button.dataset.size).toBe('icon-xs')
  expect(button.classList.contains('size-6')).toBe(true)
})

const longUrl =
  'https://devpush.example/mcp/this-is-a-long-value-that-must-be-copied-completely?project=My%20Project&view=logs#details'

test('copies the full unchanged URL when clicking its label within one button', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  await mount(
    writeText,
    false,
    <CopyButton value={longUrl} label="Copy MCP URL" className="w-full">
      <code>{longUrl}</code>
    </CopyButton>,
  )
  const button = node.querySelector<HTMLButtonElement>('button')!
  expect(node.querySelectorAll('button')).toHaveLength(1)
  expect(button.textContent).toBe(longUrl)
  expect(button.querySelectorAll('svg')).toHaveLength(1)
  expect(button.dataset.variant).toBe('ghost')
  expect(button.dataset.size).toBe('sm')
  expect(button.classList.contains('w-full')).toBe(true)
  expect(button.getAttribute('aria-label')).toBe('Copy MCP URL')
  expect(writeText).not.toHaveBeenCalled()
  await act(async () => button.querySelector('code')!.click())
  expect(writeText).toHaveBeenCalledExactlyOnceWith(longUrl)
  expect(button.textContent).toBe(longUrl)
  expect(button.getAttribute('aria-label')).toBe('Copied')
  expect(button.querySelector('svg.lucide-check')).not.toBeNull()
  await act(async () => vi.advanceTimersByTime(1500))
  expect(button.getAttribute('aria-label')).toBe('Copy MCP URL')
  expect(button.querySelector('svg.lucide-copy')).not.toBeNull()
})

test('clicking the whole-value icon exposes accessible clipboard failure without claiming success', async () => {
  const writeText = vi.fn().mockRejectedValue(new Error('Clipboard denied'))
  await mount(
    writeText,
    false,
    <CopyButton value={longUrl} label="Copy MCP URL">
      <code>{longUrl}</code>
    </CopyButton>,
  )
  const button = node.querySelector<HTMLButtonElement>('button')!
  expect(node.querySelectorAll('button')).toHaveLength(1)
  await act(async () => {
    button
      .querySelector('svg')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  expect(writeText).toHaveBeenCalledExactlyOnceWith(longUrl)
  expect(button.textContent).toBe(longUrl)
  expect(button.getAttribute('aria-label')).toBe('Unable to copy')
  expect(node.querySelector('[aria-label="Copied"]')).toBeNull()
  expect(button.querySelector('svg.lucide-check')).toBeNull()
  expect(button.querySelector('svg.lucide-copy')).not.toBeNull()
  expect(button.disabled).toBe(false)
  await act(async () => vi.advanceTimersByTime(1500))
  expect(button.getAttribute('aria-label')).toBe('Copy MCP URL')
})
