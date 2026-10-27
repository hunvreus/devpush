import assert from 'node:assert/strict'

export async function smokeAssets(origin, html) {
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
    styles += await response.text()
  }
  assert.match(styles, /--background/, 'Application theme is missing')
  const favicon = await fetch(`${origin}/favicon.svg`)
  assert.equal(favicon.status, 200)
  assert.match(await favicon.text(), /<svg/)
}
