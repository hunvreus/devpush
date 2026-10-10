import {
  mkdtempSync,
  mkdirSync,
  linkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { assertSeparateSqliteFiles } from './sqlite-files'

const directories: string[] = []
afterEach(() => {
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true })
})

test('rejects equivalent paths before opening the databases', () => {
  expect(() =>
    assertSeparateSqliteFiles(
      '.data/main.sqlite',
      '.data/../.data/main.sqlite',
    ),
  ).toThrow('separate SQLite files')
  expect(() =>
    assertSeparateSqliteFiles('.data/main.sqlite', '.data/logs.sqlite'),
  ).not.toThrow()
  expect(() => assertSeparateSqliteFiles(':memory:', ':memory:')).not.toThrow()
})

test('rejects symlinks and hard links to the same existing database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'devpush-sqlite-paths-'))
  directories.push(directory)
  const main = join(directory, 'main.sqlite')
  writeFileSync(main, '')
  const symlink = join(directory, 'symlink.sqlite')
  const hardLink = join(directory, 'hard-link.sqlite')
  symlinkSync(main, symlink)
  linkSync(main, hardLink)
  for (const path of [symlink, hardLink])
    expect(() => assertSeparateSqliteFiles(main, path)).toThrow(
      'separate SQLite files',
    )
})

test('rejects aliased parent directories before database creation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'devpush-sqlite-paths-'))
  directories.push(directory)
  const real = join(directory, 'real')
  const alias = join(directory, 'alias')
  mkdirSync(real)
  symlinkSync(real, alias)
  expect(() =>
    assertSeparateSqliteFiles(
      join(real, 'nested/main.sqlite'),
      join(alias, 'nested/main.sqlite'),
    ),
  ).toThrow('separate SQLite files')
})
