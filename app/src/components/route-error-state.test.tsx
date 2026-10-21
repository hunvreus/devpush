import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { RouteErrorState } from './route-error-state'

function render(error: unknown) {
  return renderToStaticMarkup(
    <RouteErrorState error={error} reset={() => {}} />,
  )
}

test.each([
  'PROJECT_NOT_FOUND',
  'TEAM_NOT_FOUND',
  'DEPLOYMENT_NOT_FOUND',
  'SERVER_NOT_FOUND',
])('serialized %s shows the missing-resource screen', (code) => {
  const html = render({
    name: 'PublicError',
    code,
    message: 'Resource not found.',
  })
  expect(html).toContain('Not found')
  expect(html).not.toContain('Something went wrong')
})

test('unexpected errors and unknown error codes remain generic without exposing details', () => {
  for (const error of [
    new Error('SQLITE_ERROR: missing table'),
    { code: 'UNKNOWN_NOT_FOUND', message: 'private details' },
  ]) {
    const html = render(error)
    expect(html).toContain('Something went wrong')
    expect(html).not.toContain('private details')
    expect(html).not.toContain('SQLITE_ERROR')
  }
})
