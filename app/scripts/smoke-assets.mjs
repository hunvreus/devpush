import assert from 'node:assert/strict'

export async function smokeAssets(origin, html, { production = false } = {}) {
  const stylesheetLinks = [...html.matchAll(/<link\b[^>]*>/g)]
    .map(
      ([link]) =>
        /\brel="stylesheet"/.test(link) && link.match(/\bhref="([^"]+)"/)?.[1],
    )
    .filter(Boolean)
  assert(stylesheetLinks.length, 'SSR document must include application CSS')
  let styles = ''
  for (const href of stylesheetLinks) {
    const url = new URL(href.replaceAll('&amp;', '&'), origin)
    assert.equal(url.origin, origin, 'Styles must be served by the consumer')
    const response = await fetch(url, { headers: { accept: 'text/css' } })
    assert.equal(response.status, 200, `Missing stylesheet: ${url.pathname}`)
    assert.match(response.headers.get('content-type'), /text\/css/)
    if (production && url.pathname.startsWith('/assets/')) {
      assert.match(response.headers.get('cache-control') ?? '', /max-age=31536000/)
      assert.match(response.headers.get('cache-control') ?? '', /immutable/)
    }
    styles += await response.text()
  }
  assert.match(styles, /--background/, 'Application theme is missing')
  const favicon = await fetch(`${origin}/favicon.svg`)
  assert.equal(favicon.status, 200)
  assert.match(await favicon.text(), /<svg/)
  const browserIcon = await fetch(`${origin}/favicon.ico`)
  assert.equal(browserIcon.status, 200)
  assert.deepEqual(
    [...new Uint8Array(await browserIcon.arrayBuffer()).slice(0, 4)],
    [0, 0, 1, 0],
    'Browser favicon must be a static ICO asset, not an SSR response',
  )
  if (production) {
    const missing = await fetch(`${origin}/assets/missing-asset-test.js`)
    assert.equal(missing.status, 404)
    assert.doesNotMatch(missing.headers.get('cache-control') ?? '', /max-age=31536000/)
  }
}
