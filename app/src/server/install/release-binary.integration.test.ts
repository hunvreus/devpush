import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare'
import { expect, test } from 'vitest'

test('Workers verify pinned GitHub downloads without storage and reject tampering', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: import.meta.dirname,
      loader: 'ts',
      contents: `
import {readReleasedAgentBinary} from './release-binary'
import {validateAgentRelease} from '../../lib/agent-release.mjs'
export default {async fetch(request) {
 const input=await request.json()
 const release=validateAgentRelease({schemaVersion:1,repository:'example/devpush',version:'1.2.3',goVersion:'go1.27.0',protocolVersion:1,capabilities:['ingress.certificates.v1'],assets:['amd64','arm64'].map(arch=>({os:'linux',arch,filename:'devpush-agent-linux-'+arch,url:'https://github.com/example/devpush/releases/download/v1.2.3/devpush-agent-linux-'+arch,size:input.body.length,sha256:input.sha256}))})
 const objects=new Map()
 let requests=0
 const store={exists:async key=>objects.has(key),get:async key=>({body:objects.get(key)}),put:async(key,body)=>{objects.set(key,Buffer.from(body))},delete:async key=>objects.delete(key)}
 const fetcher=async()=>{requests++;return new Response(input.tamper ? input.body.replace('shared','broken') : input.body)}
 try {
  const first=await readReleasedAgentBinary({release,asset:release.assets[0],fetcher})
  const second=await readReleasedAgentBinary({release,asset:release.assets[0],fetcher})
  return Response.json({first:first.toString(),second:second.toString(),requests,keys:[...objects.keys()]})
 } catch(error) {return Response.json({error:error.message,objects:objects.size},{status:400})}
}}
`,
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    external: ['node:crypto'],
  })
  const runtime = new Miniflare({
    workers: [
      {
        config: {
          name: 'agent-release-proof',
          compatibilityDate: '2026-08-29',
          compatibilityFlags: ['nodejs_compat'],
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': {
                type: 'esm',
                contents: bundle.outputFiles[0]!.text,
              },
            },
          },
        },
      },
    ],
  })
  try {
    const body = 'shared agent bytes',
      sha256 = createHash('sha256').update(body).digest('hex')
    const request = async (tamper = false) =>
      runtime.dispatchFetch('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ body, sha256, tamper }),
      })
    const response = await request()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      first: body,
      second: body,
      requests: 2,
      keys: [],
    })
    const tampered = await request(true)
    expect(tampered.status).toBe(400)
    expect(await tampered.json()).toMatchObject({
      objects: 0,
      error: expect.stringContaining('integrity check'),
    })
  } finally {
    await runtime.dispose()
  }
})
