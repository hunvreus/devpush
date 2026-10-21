import SwaggerParser from '@apidevtools/swagger-parser'
import { expect, test } from 'vitest'
import { createPublicOpenApiDocument } from './operation-contract'

test('the served contract validates against the official OpenAPI schema', async () => {
  const document = createPublicOpenApiDocument()
  const validated = await SwaggerParser.validate(
    document as SwaggerParser['api'],
    { resolve: { external: false } },
  )
  expect('openapi' in validated && validated.openapi).toBe('3.1.0')
})
