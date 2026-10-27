import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { Alert, AlertDescription } from './alert'

test.each([
  [undefined, 'bg-transparent'],
  ['warning', 'bg-amber-600/10'],
  ['destructive', 'bg-destructive/10'],
] as const)(
  'alert %s uses the expected background and border',
  (variant, background) => {
    const html = renderToStaticMarkup(
      <Alert variant={variant}>
        <AlertDescription>Notice</AlertDescription>
      </Alert>,
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain(background)
    expect(html).toContain(
      variant === 'warning'
        ? 'border-amber-600/20'
        : variant === 'destructive'
          ? 'border-destructive/20'
          : 'border-foreground/10',
    )
  },
)
