import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { Route } from './onboarding'

const state = vi.hoisted(() => ({ children: false }))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useLoaderData: () => ({}),
    useSearch: () => ({}),
  }),
  redirect: () => ({}),
  Outlet: () => <div>Workspace onboarding</div>,
  useChildMatches: ({
    select,
  }: {
    select: (matches: Array<object>) => unknown
  }) => select(state.children ? [{}] : []),
}))
vi.mock('#devpush/server/auth/context', () => ({
  getCurrentUserContext: vi.fn(),
}))
vi.mock('#devpush/features/onboarding/profile-onboarding', () => ({
  ProfileOnboarding: () => <div>Profile onboarding</div>,
}))

test('onboarding shows the currently presented route', () => {
  const Component = Route.options.component!
  state.children = false
  expect(renderToStaticMarkup(<Component />)).toContain('Profile onboarding')
  state.children = true
  expect(renderToStaticMarkup(<Component />)).toContain('Workspace onboarding')
})
