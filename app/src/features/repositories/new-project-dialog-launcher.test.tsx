// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { NewProjectDialogLauncher } from './new-project-dialog-launcher'

const loading = vi.hoisted(() => {
  let resolve!: () => void
  const ready = new Promise<void>((done) => {
    resolve = done
  })
  return { ready, resolve }
})
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({}),
  useParams: () => ({}),
}))
vi.mock('./new-project-dialog', async () => {
  await loading.ready
  return {
    NewProjectDialogOverlayContent: ({
      onCreated,
    }: {
      onCreated: () => void
    }) => (
      <div>
        Loaded project form<button onClick={onCreated}>Finish creation</button>
      </div>
    ),
  }
})

test('lazy loading replaces content without remounting the dialog', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  try {
    await act(async () =>
      root.render(
        <NewProjectDialogLauncher teamSlug="team">
          {(open) => <button onClick={open}>Open</button>}
        </NewProjectDialogLauncher>,
      ),
    )
    await act(async () => node.querySelector('button')!.click())
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('Create project')
    await act(async () => {
      loading.resolve()
      await loading.ready
    })
    expect(document.querySelector('[role="dialog"]')).toBe(dialog)
    expect(dialog.textContent).toContain('Loaded project form')
    await act(async () =>
      [...dialog.querySelectorAll('button')]
        .find((button) => button.textContent === 'Finish creation')!
        .click(),
    )
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  } finally {
    await act(async () => root.unmount())
    node.remove()
    vi.unstubAllGlobals()
  }
})
