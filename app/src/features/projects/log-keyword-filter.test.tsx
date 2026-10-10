// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { LogKeywordFilter } from './log-keyword-filter'

let dispose: (() => Promise<void>) | undefined
afterEach(async () => {
  await dispose?.()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
async function mount(value = '') {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  const onChange = vi.fn()
  const render = async (next: string) => {
    await act(async () =>
      root.render(<LogKeywordFilter value={next} onChange={onChange} />),
    )
  }
  const unmount = async () => {
    await act(async () => root.unmount())
    node.remove()
    dispose = undefined
  }
  dispose = unmount
  await render(value)
  const input = node.querySelector('input')!
  const fill = async (next: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, next)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const advance = async () => {
    await act(async () => vi.advanceTimersByTimeAsync(300))
  }
  return { onChange, render, input, fill, advance, unmount }
}
test('typing debounces to the last keyword and clearing removes the filter', async () => {
  const view = await mount()
  await view.fill('err')
  await view.fill(' error ')
  expect(view.onChange).not.toHaveBeenCalled()
  await view.advance()
  expect(view.onChange).toHaveBeenCalledExactlyOnceWith('error')
  await view.render('error')
  view.onChange.mockClear()
  await view.fill('')
  await view.advance()
  expect(view.onChange).toHaveBeenCalledExactlyOnceWith(null)
})
test('external reset replaces the draft and cancels its delayed navigation', async () => {
  const view = await mount('saved')
  await view.fill('pending')
  await view.render('')
  await view.advance()
  expect(view.input.value).toBe('')
  expect(view.onChange).not.toHaveBeenCalled()
})
test('leaving the page cancels a pending keyword update', async () => {
  const view = await mount()
  await view.fill('error')
  await view.unmount()
  await view.advance()
  expect(view.onChange).not.toHaveBeenCalled()
})
