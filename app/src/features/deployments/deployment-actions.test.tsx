// @vitest-environment jsdom
import { act } from 'react'
import type { ReactNode, MouseEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { DeploymentActions } from './deployment-actions'

const mocks = vi.hoisted(() => ({
  redeploy: vi.fn(),
  rollback: vi.fn(),
  navigate: vi.fn(),
}))
vi.mock('@/server/projects/functions', () => ({
  redeployProjectDeployment: mocks.redeploy,
  rollbackProjectDeployment: mocks.rollback,
}))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: mocks.navigate }),
}))
vi.mock('@/lib/project-context-query', () => ({
  invalidateProjectContext: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { warning: vi.fn() } }))
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    disabled,
    onSelect,
  }: {
    children: ReactNode
    disabled?: boolean
    onSelect: (event: MouseEvent<HTMLButtonElement>) => void
  }) => (
    <button disabled={disabled} onClick={onSelect}>
      {children}
    </button>
  ),
}))
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
async function click(label: string, scope: ParentNode = document) {
  await act(async () =>
    [...scope.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === label)!
      .click(),
  )
}
test.each(['Redeploy', 'Roll back'] as const)(
  '%s shows local failure and locks dismissal until settled',
  async (label) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const action = label === 'Redeploy' ? mocks.redeploy : mocks.rollback
    let reject!: (error: Error) => void
    action.mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail
        }),
    )
    const node = document.createElement('div')
    document.body.append(node)
    const root = createRoot(node)
    cleanup.push(async () => {
      await act(async () => root.unmount())
      node.remove()
    })
    await act(async () =>
      root.render(
        <DeploymentActions
          teamSlug="team"
          deployment={{
            id: 'd',
            status: 'succeeded',
            projectName: 'project',
            gitSha: '12345678',
            gitBranch: 'main',
            environmentName: 'Production',
            environmentColor: 'lime',
            commitMessage: 'Commit',
            githubRepo: 'owner/repo',
          }}
        />,
      ),
    )
    await click(label, node)
    await click(label, document.querySelector('[role="alertdialog"]')!)
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    )
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
    await click(label, document.querySelector('[role="alertdialog"]')!)
    expect(action).toHaveBeenCalledTimes(1)
    await act(async () => reject(new Error('HTTPError')))
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'Unable to queue',
    )
    action.mockResolvedValueOnce({ deploymentId: 'next' })
    await click(label, document.querySelector('[role="alertdialog"]')!)
    expect(action).toHaveBeenCalledTimes(2)
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
  },
)
