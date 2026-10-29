// @vitest-environment jsdom
import { act } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { useTheme } from 'next-themes'
import { Route } from './__root'

vi.mock('@tanstack/react-router', () => ({
  HeadContent: () => null,
  Scripts: () => null,
  Outlet: () => null,
  createRootRouteWithContext: () => (options: unknown) => ({ options }),
}))
vi.mock('#devpush/components/ui/sonner', () => ({
  Toaster: () => {
    const { theme } = useTheme()
    return <output data-testid="toast-theme">{theme ?? 'missing'}</output>
  },
}))
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

test('global toasts share the selected theme even outside the normal route content', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }))
  localStorage.setItem('theme', 'light')
  const root = createRoot(document)
  const Document = (
    Route.options as unknown as {
      shellComponent: ComponentType<{ children: ReactNode }>
    }
  ).shellComponent
  try {
    await act(async () =>
      root.render(
        <Document>
          <main>Route error content</main>
        </Document>,
      ),
    )
    expect(
      document.querySelector('[data-testid="toast-theme"]')?.textContent,
    ).toBe('light')
    expect(document.documentElement.classList.contains('light')).toBe(true)
  } finally {
    await act(async () => root.unmount())
  }
})

test('the app defaults to the system theme when no preference is saved', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }))
  const root = createRoot(document)
  const Document = (
    Route.options as unknown as {
      shellComponent: ComponentType<{ children: ReactNode }>
    }
  ).shellComponent
  try {
    await act(async () =>
      root.render(
        <Document>
          <main>Consent</main>
        </Document>,
      ),
    )
    expect(
      document.querySelector('[data-testid="toast-theme"]')?.textContent,
    ).toBe('system')
    expect(document.documentElement.classList.contains('light')).toBe(true)
  } finally {
    await act(async () => root.unmount())
  }
})
