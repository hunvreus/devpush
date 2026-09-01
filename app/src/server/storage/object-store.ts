import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

import { config } from '@/server/config'
import { getR2ObjectStore } from '@/server/runtime/platform-env'

type StoredObject = {
  body: Buffer
  contentType?: string
}

export interface ObjectStore {
  delete: (key: string) => Promise<void>
  get: (key: string) => Promise<StoredObject>
  put: (key: string, body: Uint8Array, contentType?: string) => Promise<void>
}

let store: ObjectStore | undefined

export function getObjectStore() {
  const r2 = getR2ObjectStore()

  if (r2) {
    return createR2ObjectStore(r2)
  }

  store ??= isRemoteObjectStorageConfigured()
    ? createS3ObjectStore()
    : createLocalObjectStore()

  return store
}

export function isObjectStorageConfigured() {
  return Boolean(getR2ObjectStore()) || isRemoteObjectStorageConfigured()
}

function createR2ObjectStore(bucket: R2Bucket): ObjectStore {
  return {
    async delete(key) {
      await bucket.delete(key)
    },
    async get(key) {
      const object = await bucket.get(key)
      if (!object) throw new Error(`Object ${key} was not found.`)

      return {
        body: Buffer.from(await object.arrayBuffer()),
        contentType: object.httpMetadata?.contentType,
      }
    },
    async put(key, body, contentType) {
      await bucket.put(key, body, {
        httpMetadata: contentType ? { contentType } : undefined,
      })
    },
  }
}

export function isRemoteObjectStorageConfigured() {
  return Boolean(
    config.DEVPUSH_STORAGE_ENDPOINT &&
    config.DEVPUSH_STORAGE_BUCKET &&
    config.DEVPUSH_STORAGE_ACCESS_KEY_ID &&
    config.DEVPUSH_STORAGE_SECRET_ACCESS_KEY,
  )
}

function createLocalObjectStore(): ObjectStore {
  const root = path.join(process.cwd(), 'public', 'uploads')

  return {
    async delete(key) {
      try {
        await unlink(resolveLocalKey(root, key))
      } catch (error) {
        if (!isMissingFile(error)) throw error
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

function createS3ObjectStore(): ObjectStore {
  const bucket = config.DEVPUSH_STORAGE_BUCKET!
  const client = new S3Client({
    endpoint: config.DEVPUSH_STORAGE_ENDPOINT,
    region: config.DEVPUSH_STORAGE_REGION ?? 'auto',
    credentials: {
      accessKeyId: config.DEVPUSH_STORAGE_ACCESS_KEY_ID!,
      secretAccessKey: config.DEVPUSH_STORAGE_SECRET_ACCESS_KEY!,
    },
  })

  return {
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    },
    async get(key) {
      const result = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      )

      if (!result.Body) throw new Error(`Object ${key} has no content.`)

      return {
        body: Buffer.from(await result.Body.transformToByteArray()),
        contentType: result.ContentType,
      }
    },
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Body: body,
          Bucket: bucket,
          ContentType: contentType,
          Key: key,
        }),
      )
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
