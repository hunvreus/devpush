// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { DomainSettingsTable } from './project-routing-settings'
import { TooltipProvider } from '@/components/ui/tooltip'

let cleanup: (() => Promise<void>) | undefined
afterEach(async () => {
  await cleanup?.()
  vi.unstubAllGlobals()
})
test('verification errors belong to their domain host, with no status column or required footnote', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  cleanup = async () => {
    await act(async () => root.unmount())
    node.remove()
  }
  await act(async () =>
    root.render(
      <TooltipProvider>
        <DomainSettingsTable
          domains={[
            {
              id: 'a',
              host: 'a.example.com',
              environment: 'e',
              baseRoute: '',
              https: true,
              status: 'pending',
            },
            {
              id: 'b',
              host: 'b.example.com',
              environment: 'e',
              baseRoute: '',
              https: true,
              status: 'active',
            },
            {
              id: 'draft',
              host: 'new.example.com',
              environment: 'e',
              baseRoute: '',
              https: true,
            },
          ]}
          servers={[
            {
              id: 'host',
              name: 'Application host',
              publicAddress: '203.0.113.10',
              publicIpv4: '203.0.113.10',
              publicIpv6: '2001:db8::10',
            },
          ]}
          environments={[
            {
              id: 'e',
              name: 'Production',
              slug: 'production',
              branch: 'main',
              color: 'lime',
              position: 0,
              status: 'active',
              serverId: 'host',
              effectiveServerId: 'host',
            },
          ]}
          routes={[]}
          errors={{
            'verification.a': 'DNS record does not point to this server.',
          }}
          onChange={vi.fn()}
          onVerify={vi.fn()}
          verifyingDomainId={null}
          verificationDisabled={false}
        />
      </TooltipProvider>,
    ),
  )
  const alert = node.querySelector('[data-slot="alert"]')!
  expect(alert.classList.contains('text-destructive')).toBe(false)
  expect(alert.querySelector('svg.lucide-triangle-alert')).not.toBeNull()
  expect(
    alert.querySelector('[data-slot="alert-description"] > div')
      ?.lastElementChild?.textContent,
  ).toBe('Error details: DNS record does not point to this server.')
  expect(alert.querySelector('[data-slot=alert-title]')?.className).toContain(
    'text-amber-600',
  )
  expect(alert.querySelector('[data-slot=alert-title]')?.className).toContain(
    'dark:text-amber-400',
  )
  expect(
    alert.querySelector('[data-slot=alert-description] > div')?.className,
  ).toContain('gap-4')
  expect(
    alert.querySelector('[data-slot=alert-description] > div')?.lastElementChild
      ?.className,
  ).toContain('text-muted-foreground')
  expect(alert.textContent).toContain('one or both')
  expect(
    node.querySelector(
      '[data-slot="alert"] [aria-label="Verify a.example.com"]',
    ),
  ).not.toBeNull()
  const hosts = node.querySelectorAll<HTMLInputElement>(
    '[aria-label="Domain host"]',
  )
  expect(hosts[0]?.getAttribute('aria-invalid')).toBe('false')
  expect(hosts[1]?.getAttribute('aria-invalid')).toBe('false')
  expect(hosts[0]?.readOnly).toBe(true)
  expect(hosts[1]?.readOnly).toBe(true)
  expect(hosts[2]?.readOnly).toBe(false)
  expect(node.querySelector('[data-slot=alert]')?.textContent).toContain(
    'DNS record does not point',
  )
  expect(node.textContent).toContain('203.0.113.10')
  expect(node.textContent).toContain('2001:db8::10')
  expect(node.textContent).toContain('Application host')
  expect(node.querySelector('[data-slot=alert] table')?.textContent).toContain(
    'Aa.example.com203.0.113.10',
  )
  const description = alert.querySelector(
    '[data-slot="alert-description"] > div',
  )!
  expect(description.firstElementChild?.textContent).toContain(
    'Disable CDN/proxy mode',
  )
  expect(description.children).toHaveLength(3)
  expect(description.children[1]?.querySelector('table')).not.toBeNull()
  expect(
    alert
      .querySelector('[aria-label="Verify a.example.com"]')
      ?.getAttribute('data-variant'),
  ).toBe('default')
  expect(node.textContent).not.toContain('Status')
  expect(node.textContent).not.toContain('Verified')
  expect(node.textContent).not.toContain('* Required')
})
