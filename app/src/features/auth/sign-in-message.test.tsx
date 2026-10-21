import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { SignInMessage } from './sign-in-message'

test('an unset message renders nothing', () => {
  expect(renderToStaticMarkup(<SignInMessage message="  " />)).toBe('')
})

test('messages escape markup and only link explicit web URLs', () => {
  const html = renderToStaticMarkup(
    <SignInMessage
      message={
        '<script>alert(1)</script>\nEmployees: https://acme.com/access. javascript:alert(1)'
      }
    />,
  )
  expect(html).toContain('&lt;script&gt;')
  expect(html).not.toContain('<script>')
  expect(html).toContain('href="https://acme.com/access"')
  expect(html).toContain('rel="noopener noreferrer"')
  expect(html.match(/<a /g)).toHaveLength(1)
})
