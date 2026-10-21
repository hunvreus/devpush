import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test, expect } from 'vitest'
import {
  resolveServerDeployment,
  deploymentStylesSource,
} from '../../deployment.config.mjs'

test('selects a private server entry only at build time and rejects missing entries', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'devpush-entry-'))
  try {
    mkdirSync(resolve(root, 'src/deployment'), { recursive: true })
    writeFileSync(resolve(root, 'src/deployment/default.server.ts'), '')
    writeFileSync(resolve(root, 'src/deployment/default.ui.tsx'), '')
    const entry = resolve(root, 'private.server.ts')
    writeFileSync(entry, '')
    expect(resolveServerDeployment({}, root).server).toBe(
      resolve(root, 'src/deployment/default.server.ts'),
    )
    const selected = resolveServerDeployment(
      { DEVPUSH_DEPLOYMENT_SERVER: entry },
      root,
    )
    expect(selected.server).toBe(entry)
    expect(
      selected.aliases.find(
        (alias) => alias.find === '#devpush/deployment/server',
      )?.replacement,
    ).toBe(entry)
    expect(
      selected.aliases.find(
        (alias) => alias.find === '#devpush/deployment/contract',
      )?.replacement,
    ).toBe(resolve(root, 'src/deployment/contract.ts'))
    expect(() =>
      resolveServerDeployment(
        { DEVPUSH_DEPLOYMENT_UI: 'missing-ui.tsx' },
        root,
      ),
    ).toThrow('client deployment')
    expect(() =>
      resolveServerDeployment(
        { DEVPUSH_DEPLOYMENT_SERVER: 'missing.ts' },
        root,
      ),
    ).toThrow('does not exist')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('external deployment UI is scanned for Tailwind classes only in private builds', () => {
  expect(deploymentStylesSource('/repo/app/src/deployment', '/repo/app')).toBe(
    '',
  )
  expect(deploymentStylesSource('/repo/hosted', '/repo/app')).toBe(
    '\n@source "/repo/hosted";\n',
  )
})
