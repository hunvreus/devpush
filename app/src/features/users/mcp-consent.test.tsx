// @vitest-environment jsdom
import { act } from 'react'
import type { ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { completeMcpConsentAction } from '#devpush/server/mcp/functions'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { McpConsent, McpConsentPending } from './mcp-consent'

vi.mock('./api-scope-selection', () => ({ ApiScopeSelection: () => null }))
vi.mock('#devpush/server/mcp/functions', () => ({
  completeMcpConsentAction: vi.fn(),
}))

test('consent identifies the client without fetching its favicon and leaves logs opt-in', () => {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = renderToStaticMarkup(
    <McpConsent
      context={{
        userId: 'user',
        account: { name: 'Test user', email: 'user@example.test', image: null },
        clientId: 'client',
        clientName: 'ChatGPT',
        clientHost: 'chatgpt.com',
        clientLogoUrl: null,
        redirectHost: 'chatgpt.com',
        requestedPermissions: ['read', 'manage'],
        allowLogs: true,
        teams: [],
        oauthQuery: 'query',
      }}
    />,
  )
  expect(wrapper.querySelector('h1')?.textContent).toBe(
    'ChatGPT is requesting access to your devpush account',
  )
  expect(wrapper.querySelector('header')?.textContent).not.toContain(
    'unverified',
  )
  expect(wrapper.textContent).toContain(
    'ChatGPT by chatgpt.com is requesting the following access (expires in 30 days):',
  )
  expect(wrapper.querySelector('[data-slot="tooltip-trigger"]')).toBeNull()
  const account = wrapper.querySelector(
    'section[aria-label="Signed-in account"]',
  )
  expect(account?.textContent).toContain('Test user')
  expect(account?.textContent).toContain('user@example.test')
  expect(wrapper.textContent).not.toContain('Choose what this app can access')
  expect(wrapper.querySelector('[data-slot="card"]')?.textContent).toContain(
    '(expires in 30 days):',
  )
  expect(wrapper.textContent).not.toContain('Returns to')
  const checkbox = wrapper.querySelector('#consent-logs')!
  expect(checkbox.getAttribute('aria-checked')).toBe('false')
  expect(wrapper.querySelector('label[for="consent-logs"]')?.textContent).toBe(
    'Allow access to logs',
  )
  expect(checkbox.getAttribute('aria-describedby')).toBe(
    'consent-logs-description',
  )
  expect(
    wrapper
      .querySelector('[aria-label="App connection"]')
      ?.closest('[data-slot="card"]'),
  ).toBeNull()
})

test('pending consent keeps the card, account row and actions in the same hierarchy', () => {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = renderToStaticMarkup(<McpConsentPending />)
  expect(wrapper.querySelector('[aria-busy="true"]')).not.toBeNull()
  expect(wrapper.querySelector('[data-slot="card"] h1')).toBeNull()
  for (const button of wrapper.querySelectorAll('button')) {
    expect(button.disabled).toBe(true)
    if (button.textContent === 'Cancel' || button.textContent === 'Authorize')
      expect(button.closest('[data-slot="card"]')).toBeNull()
  }
})

test.each([true, false])(
  'only the chosen consent action loads: accepted=%s',
  async (accepted) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.mocked(completeMcpConsentAction).mockReturnValueOnce(
      new Promise(() => {}),
    )
    const wrapper = document.createElement('div')
    document.body.append(wrapper)
    const root = createRoot(wrapper)
    const context: ComponentProps<typeof McpConsent>['context'] = {
      userId: 'user',
      account: { name: 'Test user', email: 'user@example.test', image: null },
      clientId: 'client',
      clientName: 'Assistant',
      clientHost: null,
      clientLogoUrl: null,
      redirectHost: 'assistant.example',
      requestedPermissions: ['read'],
      allowLogs: true,
      oauthQuery: 'query',
      teams: [
        {
          id: 'team',
          name: 'Team',
          slug: 'team',
          role: 'owner',
          image: null,
          color: 'blue',
          projects: [],
        },
      ],
    }
    try {
      await act(async () => {
        root.render(<McpConsent context={context} />)
      })
      const buttons = [...wrapper.querySelectorAll('button')]
      const selected = buttons.find(
        (button) => button.textContent === (accepted ? 'Authorize' : 'Cancel'),
      )!
      const other = buttons.find(
        (button) => button.textContent === (accepted ? 'Cancel' : 'Authorize'),
      )!
      await act(async () => {
        selected.click()
      })
      expect(selected.querySelector('.animate-spin')).not.toBeNull()
      expect(other.querySelector('.animate-spin')).toBeNull()
      expect(selected.disabled).toBe(true)
      expect(other.disabled).toBe(true)
      expect(completeMcpConsentAction).toHaveBeenLastCalledWith({
        data: {
          oauthQuery: 'query',
          accepted,
          teamId: accepted ? 'team' : undefined,
          projectIds: null,
          preset: 'read',
          includeLogs: false,
        },
      })
    } finally {
      await act(async () => {
        root.unmount()
      })
      wrapper.remove()
      vi.unstubAllGlobals()
    }
  },
)
