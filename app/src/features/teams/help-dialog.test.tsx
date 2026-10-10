// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test } from 'vitest'
import { HelpDialog } from './help-dialog'
import packageJson from '../../../package.json'

test('help opens a dialog with the installed version and external resources', async () => {
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  try {
    await act(async () => root.render(<HelpDialog />))
    await act(async () =>
      node.querySelector<HTMLButtonElement>('button')!.click(),
    )
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain(packageJson.version)
    expect(dialog.textContent).toContain('devpush')
    const links = dialog.querySelectorAll('a')
    expect(links.length).toBe(4)
    for (const link of links) {
      expect(link.target).toBe('_blank')
      expect(link.rel).toContain('noopener')
    }
  } finally {
    await act(async () => root.unmount())
    node.remove()
  }
})
