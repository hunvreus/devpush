import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  AdminSettingsPending,
  UserSettingsPending,
} from './settings-route-pending'

vi.mock('@tanstack/react-router', () => ({
  useHydrated: () => true,
  getRouteApi: () => ({ useLoaderData: () => undefined }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))

test('account loading uses the loaded field spacing and known controls', () => {
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <UserSettingsPending />
    </TooltipProvider>,
  )
  expect(html).toContain('data-slot="field-group"')
  expect(html).toContain('Name (required)')
  expect(html).toContain('Username (required)')
  expect(html).toContain('Email (required)')
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save<\/button>/)
  expect(html).toContain('Upload image')
  expect(html).toContain('Loading sign-in methods…')
})

test('admin loading keeps search and allowlist actions visible but disabled', () => {
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <AdminSettingsPending />
    </TooltipProvider>,
  )
  expect(html).toContain('placeholder="Search..."')
  expect(html).toContain('Add rule')
  expect(html).toMatch(
    /<button[^>]*disabled=""[^>]*aria-label="More allowlist actions"/,
  )
  expect(html).not.toContain('No allowlist entries')
})
