// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { useAvatarInput } from './use-avatar-input'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function setup() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const readers: FileReader[] = []
  vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (
    this: FileReader,
  ) {
    readers.push(this)
  })
  let input!: ReturnType<typeof useAvatarInput>
  function View() {
    input = useAvatarInput()
    return null
  }
  const node = document.createElement('div')
  const root = createRoot(node)
  await act(async () => root.render(<View />))
  return {
    get input() {
      return input
    },
    readers,
    close: async () => {
      await act(async () => root.unmount())
    },
  }
}
const file = new File(['image'], 'image.png', { type: 'image/png' })
function loaded(reader: FileReader, result: string) {
  Object.defineProperty(reader, 'result', { value: result })
  reader.dispatchEvent(new ProgressEvent('load'))
}

test('a newer selection cancels the old read and keeps pending until the latest finishes', async () => {
  const view = await setup()
  let first!: Promise<string | null>
  let second!: Promise<string | null>
  await act(async () => {
    first = view.input.read(file)
  })
  expect(view.input.pending).toBe(true)
  await act(async () => {
    second = view.input.read(file)
  })
  expect(await first).toBeNull()
  await act(async () => loaded(view.readers[0]!, 'old'))
  expect(view.input.pending).toBe(true)
  await act(async () => loaded(view.readers[1]!, 'new'))
  expect(await second).toBe('new')
  expect(view.input.pending).toBe(false)
  await view.close()
})

test('removing an image cancels a pending read', async () => {
  const view = await setup()
  let reading!: Promise<string | null>
  await act(async () => {
    view.input.setDataUrl('existing')
    reading = view.input.read(file)
  })
  await act(async () => view.input.setDataUrl(null))
  expect(await reading).toBeNull()
  await act(async () => loaded(view.readers[0]!, 'late'))
  expect(view.input.dataUrl).toBeNull()
  expect(view.input.pending).toBe(false)
  await view.close()
})

test('failed reads leave the existing image intact and allow a retry', async () => {
  const view = await setup()
  let failure!: Promise<unknown>
  await act(async () => {
    view.input.setDataUrl('existing')
    failure = view.input.read(file).catch((error) => error)
  })
  await act(async () => {
    view.readers[0]!.dispatchEvent(new ProgressEvent('error'))
  })
  expect(await failure).toBeInstanceOf(Error)
  expect(view.input.dataUrl).toBe('existing')
  expect(view.input.pending).toBe(false)
  let retry!: Promise<string | null>
  await act(async () => {
    retry = view.input.read(file)
  })
  await act(async () => loaded(view.readers[1]!, 'retry'))
  expect(await retry).toBe('retry')
  await view.close()
})

test('unmount settles and ignores the pending read', async () => {
  const view = await setup()
  let reading!: Promise<string | null>
  await act(async () => {
    reading = view.input.read(file)
  })
  await view.close()
  expect(await reading).toBeNull()
  loaded(view.readers[0]!, 'late')
})
