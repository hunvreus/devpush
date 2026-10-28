import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { TooltipProvider } from '#devpush/components/ui/tooltip'
import {
  AdminSettingsPending,
  UserSettingsPending,
} from './settings-route-pending'

vi.mock('@tanstack/react-router', () => ({
  useHydrated: () => true,
  getRouteApi: () => ({
    useLoaderData: () => undefined,
    useNavigate: () => vi.fn(),
  }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))

test('account loading uses the loaded field spacing and known controls', () => {
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <UserSettingsPending />
    </TooltipProvider>,
  )
  expect(html).toContain('data-slot="field-group"')
  expect(html).toContain('Name')
  expect(html).toContain('Username')
  expect(html).toContain('Email')
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save<\/button>/)
  expect(html).toContain('Upload profile picture')
  expect(html).toContain('Loading sign-in methods…')
  expect(html).toContain(
    'Connect apps with browser sign-in or an API key using this MCP URL;',
  )
  expect(html).toContain('id="connected-apps"')
  expect(html).toContain('id="api-keys"')
  expect(html).toContain('aria-label="MCP URL loading"')
  expect(html).not.toContain('Connect app</button>')
  expect(html).toMatch(
    /<button(?=[^>]*disabled="")(?=[^>]*aria-label="Copy MCP URL")[^>]*>/,
  )
  expect(html).toContain('aria-label="Connected apps loading"')
  expect(html).toMatch(
    /<thead[\s\S]*?<th[^>]*>Status<\/th>[\s\S]*?<th[^>]*>App<\/th>[\s\S]*?<th[^>]*>Scope<\/th>[\s\S]*?<th[^>]*>Access<\/th>[\s\S]*?<th[^>]*>Expires<\/th>[\s\S]*?<th[^>]*><span class="sr-only">Actions<\/span><\/th>/,
  )
})

test('admin loading keeps search and allowlist actions visible but disabled', () => {
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <AdminSettingsPending />
    </TooltipProvider>,
  )
  expect(html).toContain('placeholder="Search users..."')
  expect(html).toContain('placeholder="Search rules..."')
  expect(html).toContain('Add rule')
  expect(html).toMatch(
    /<button[^>]*disabled=""[^>]*aria-label="More allowlist actions"/,
  )
  expect(html).not.toContain('No allowlist entries')
  expect(html).not.toMatch(/>Search<\/button>/)
})
