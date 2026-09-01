import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'

import { LoginForm } from './login-form'

describe('LoginForm', () => {
  test('hides email login when email delivery is not configured', () => {
    const html = renderToStaticMarkup(
      <LoginForm
        authMethods={{ email: false, github: true, google: false }}
        redirectPath="/"
      />,
    )

    expect(html).not.toContain('Continue with email')
    expect(html).not.toContain('type="email"')
    expect(html).not.toContain('>Or<')
    expect(html).toContain('Continue with GitHub')
  })

  test('shows the email and social login separator when both are configured', () => {
    const html = renderToStaticMarkup(
      <LoginForm
        authMethods={{ email: true, github: true, google: false }}
        redirectPath="/"
      />,
    )

    expect(html).toContain('Continue with email')
    expect(html).toContain('type="email"')
    expect(html).toContain('>Or<')
    expect(html).toContain('Continue with GitHub')
  })
})
