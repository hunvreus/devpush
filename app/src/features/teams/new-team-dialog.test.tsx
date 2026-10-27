// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { NewTeamDialogLauncher } from './new-team-dialog'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  after: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('#devpush/server/teams/functions', () => ({
  createTeamAction: mocks.create,
}))
vi.mock('sonner', () => ({
  toast: { success: mocks.success, warning: mocks.warning },
}))
let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
async function mount() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  await act(async () =>
    root.render(
      <NewTeamDialogLauncher onCreated={mocks.after}>
        {(open) => <button onClick={open}>New team</button>}
      </NewTeamDialogLauncher>,
    ),
  )
  close = async () => {
    await act(async () => root.unmount())
    node.remove()
  }
  await act(async () => node.querySelector('button')!.click())
}
async function fill(value: string) {
  await act(async () => {
    const input = document.getElementById('new-team-name')!
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function submit() {
  await act(async () =>
    document
      .getElementById('create-team-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  )
}
test('blank name is required and rejects before sending', async () => {
  await mount()
  await submit()
  expect(mocks.create).not.toHaveBeenCalled()
  expect(document.getElementById('new-team-name-error')?.textContent).toBe(
    'Enter a team name.',
  )
  expect(document.activeElement?.id).toBe('new-team-name')
})
test('failure preserves name for retry and pending creation blocks Escape, edits and repeat submits', async () => {
  await mount()
  await fill('My team')
  mocks.create.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await submit()
  expect(
    document.querySelector('[role="dialog"] [role="alert"]')?.textContent,
  ).toContain('Unable to connect')
  expect(
    (document.getElementById('new-team-name') as HTMLInputElement).value,
  ).toBe('My team')
  let resolve!: (value: { slug: string }) => void
  mocks.create.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done
    }),
  )
  await submit()
  await submit()
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  )
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  expect(
    (document.getElementById('new-team-name') as HTMLInputElement).disabled,
  ).toBe(true)
  expect(mocks.create).toHaveBeenCalledTimes(2)
  await act(async () => resolve({ slug: 'my-team' }))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(mocks.after).toHaveBeenCalledWith('my-team')
})
test('navigation failure after creation warns instead of offering to create again', async () => {
  await mount()
  await fill('My team')
  mocks.create.mockResolvedValueOnce({ slug: 'my-team' })
  mocks.after.mockRejectedValueOnce(new Error('navigation failed'))
  await submit()
  expect(mocks.success).toHaveBeenCalled()
  expect(mocks.warning).toHaveBeenCalled()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})
