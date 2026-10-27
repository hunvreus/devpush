import { useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, test, vi } from 'vitest'
import { defineClientPlugin } from '#devpush/plugins/client'
import type { ClientPluginEntry } from '#devpush/plugins/client'

const fixtures = vi.hoisted(() => ({ entries: [] as ClientPluginEntry[] }))
vi.mock('#devpush/plugins/registered-client', () => ({
  default: fixtures.entries,
}))

afterEach(() => {
  fixtures.entries.length = 0
  vi.resetModules()
})

test('static contributions preserve settings, pending states and account/workspace scope', async () => {
  fixtures.entries.push({
    id: 'example',
    implementation: defineClientPlugin({
      workspace: {
        header: ({ teamSlug, role }) => (
          <span>
            {teamSlug}:{role}
          </span>
        ),
        settings: {
          navigation: [{ href: '#workspace-extra', label: 'Workspace extra' }],
          Content: ({ teamSlug }) => <section>{teamSlug} settings</section>,
          Pending: () => <section>Workspace extra loading</section>,
        },
        useServerSetup: ({ teamSlug }) => ({
          fields: <span>{teamSlug} setup</span>,
          ready: true,
        }),
      },
      account: {
        navigation: [{ href: '#account-extra', label: 'Account extra' }],
        Content: ({ userId }) => <section>{userId} account</section>,
        Pending: () => <section>Account extra loading</section>,
      },
    }),
  })
  const ui = await import('./contributions')
  expect(ui.workspaceSettingsNavigation).toEqual([
    { href: '#workspace-extra', label: 'Workspace extra' },
  ])
  expect(ui.accountSettingsNavigation).toEqual([
    { href: '#account-extra', label: 'Account extra' },
  ])
  expect(
    renderToStaticMarkup(
      <ui.WorkspacePluginContributions
        place="header"
        teamSlug="acme"
        role="owner"
      />,
    ),
  ).toContain('acme:owner')
  expect(
    renderToStaticMarkup(
      <ui.WorkspaceSettingsContributions teamSlug="acme" role="owner" />,
    ),
  ).toContain('acme settings')
  expect(renderToStaticMarkup(<ui.WorkspaceSettingsPending />)).toContain(
    'Workspace extra loading',
  )
  expect(
    renderToStaticMarkup(<ui.AccountSettingsContributions userId="user-1" />),
  ).toContain('user-1 account')
  expect(renderToStaticMarkup(<ui.AccountSettingsPending />)).toContain(
    'Account extra loading',
  )
  function Setup() {
    const setup = ui.useWorkspaceServerSetup({ teamSlug: 'acme' })
    return <div data-ready={setup.ready}>{setup.fields}</div>
  }
  expect(renderToStaticMarkup(<Setup />)).toContain('acme setup')
})

test('profile contributions can use React hooks and complete their own data', async () => {
  const complete = vi.fn(async () => {})
  fixtures.entries.push({
    id: 'example',
    implementation: defineClientPlugin({
      profile: {
        useFields({ userId }) {
          const [value] = useState(userId)
          return { fields: <span>{value} field</span>, complete }
        },
      },
    }),
  })
  const ui = await import('./contributions')
  let submit: (() => Promise<void>) | undefined
  function Profile() {
    const contribution = ui.useProfileContributions({ userId: 'user-1' })
    submit = contribution.complete
    return contribution.fields
  }
  expect(renderToStaticMarkup(<Profile />)).toContain('user-1 field')
  await submit?.()
  expect(complete).toHaveBeenCalledOnce()
})

test('plugins own action error handling and optional workspace onboarding', async () => {
  const action = vi.fn(({ error }) => error === 'handled')
  const continueOnboarding = vi.fn()
  fixtures.entries.push({
    id: 'example',
    implementation: defineClientPlugin({
      workspace: {
        requestAction: action,
        onboarding: ({ teamSlug, onContinue }) => {
          onContinue()
          return <span>{teamSlug} next</span>
        },
      },
    }),
  })
  const ui = await import('./contributions')
  expect(ui.requestWorkspaceAction({ teamSlug: 'acme', error: 'other' })).toBe(
    false,
  )
  expect(
    ui.requestWorkspaceAction({ teamSlug: 'acme', error: 'handled' }),
  ).toBe(true)
  expect(ui.hasWorkspaceOnboarding()).toBe(true)
  expect(
    renderToStaticMarkup(
      <ui.WorkspaceOnboarding
        teamSlug="acme"
        role="owner"
        onContinue={continueOnboarding}
      />,
    ),
  ).toContain('acme next')
  expect(continueOnboarding).toHaveBeenCalledOnce()
})

test('an unextended application has no extra navigation or onboarding', async () => {
  const ui = await import('./contributions')
  expect(ui.workspaceSettingsNavigation).toEqual([])
  expect(ui.accountSettingsNavigation).toEqual([])
  expect(ui.hasWorkspaceOnboarding()).toBe(false)
  expect(
    ui.requestWorkspaceAction({ teamSlug: 'acme', error: new Error('failed') }),
  ).toBe(false)
})

test('conflicting profile hooks and duplicate plugin identities fail at composition', async () => {
  const implementation = defineClientPlugin({
    profile: { useFields: () => ({ fields: null, complete: async () => {} }) },
  })
  fixtures.entries.push(
    { id: 'first', implementation },
    { id: 'second', implementation },
  )
  await expect(import('./contributions')).rejects.toThrow(
    'Conflicting profile contributions',
  )
  vi.resetModules()
  fixtures.entries[1] = { id: 'first', implementation }
  await expect(import('./contributions')).rejects.toThrow(
    'Duplicate client plugin',
  )
})
