// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { McpConsent } from './mcp-consent'

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
        clientId: 'client',
        clientName: 'ChatGPT',
        redirectHost: 'chatgpt.com',
        requestedPermissions: ['read', 'manage'],
        allowLogs: true,
        teams: [],
        oauthQuery: 'query',
      }}
    />,
  )
  expect(wrapper.textContent).toContain('ChatGPT')
  expect(wrapper.textContent).toContain('Returns to chatgpt.com')
  expect(wrapper.querySelector('img')).toBeNull()
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
      .querySelector('[aria-label="devpush"]')
      ?.closest('[data-slot="card"]'),
  ).toBeNull()
})
