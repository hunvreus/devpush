import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ObjectStore } from './object-store'

export function createLocalObjectStore(): ObjectStore {
  const root = path.join(process.cwd(), 'public', 'uploads')

  return {
    async delete(key) {
      try {
        await unlink(resolveLocalKey(root, key))
      } catch (error) {
        if (!isMissingFile(error)) throw error
      }
    },
    async exists(key) {
      try {
        await access(resolveLocalKey(root, key))
        return true
      } catch (error) {
        if (isMissingFile(error)) return false
        throw error
      }
    },
    async get(key) {
      return { body: await readFile(resolveLocalKey(root, key)) }
    },
    async put(key, body) {
      const filePath = resolveLocalKey(root, key)
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(filePath, body)
    },
  }
}

function resolveLocalKey(root: string, key: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(key) || key.includes('..')) {
    throw new Error('Invalid object key.')
  }

  return path.join(root, key)
}

function isMissingFile(error: unknown) {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}
