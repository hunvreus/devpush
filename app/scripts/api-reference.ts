import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { apiRoleRank, apiScopeDefinitions } from '../src/lib/api-key-schema'
import { publicApiOperations } from '../src/server/api/operation-contract'
import type { PublicApiOperation } from '../src/server/api/operation-contract'

type Schema = {
  type?: string | string[]
  properties?: Record<string, Schema>
  required?: string[]
  items?: Schema
  anyOf?: Schema[]
  oneOf?: Schema[]
  additionalProperties?: boolean | Schema
  enum?: unknown[]
  const?: unknown
  default?: unknown
  description?: string
  format?: string
  pattern?: string
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
}
const groups = [
  {
    slug: 'api-projects',
    title: 'Projects',
    match: /project|environment|variable|domain|alias|github/,
  },
  {
    slug: 'api-deployments',
    title: 'Deployments and logs',
    match: /deploy|rollback|runtime_logs/,
  },
  { slug: 'api-servers', title: 'Servers', match: /server/ },
  { slug: 'api-backups', title: 'Backups and jobs', match: /backup|job/ },
]
function groupFor(operation: PublicApiOperation) {
  return groups.find((group) => group.match.test(operation.id))
}
function title(operation: PublicApiOperation) {
  const text = operation.id.replaceAll('_', ' ').replace('github', 'GitHub')
  return text[0]!.toUpperCase() + text.slice(1)
}
function link(operation: PublicApiOperation) {
  return `/docs/${groupFor(operation)?.slug ?? 'api-operations'}/#${operation.id.replaceAll('_', '-')}`
}
const cell = (value: unknown) =>
  String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
const code = (value: unknown) => '`' + cell(value) + '`'
function type(schema: Schema): string {
  const variants = schema.anyOf ?? schema.oneOf
  if (variants) return [...new Set(variants.map(type))].join(' or ')
  if (Array.isArray(schema.type)) return schema.type.join(' or ')
  if (schema.type === 'array') return `${type(schema.items ?? {})}[]`
  return schema.type ?? 'value'
}
function notes(schema: Schema): string {
  const parts: string[] = []
  if (schema.description) parts.push(cell(schema.description))
  if ('default' in schema)
    parts.push(`Default: ${code(JSON.stringify(schema.default))}.`)
  if ('const' in schema)
    parts.push(`Exactly ${code(JSON.stringify(schema.const))}.`)
  if (schema.enum)
    parts.push(
      schema.enum.map((value) => code(JSON.stringify(value))).join(', ') + '.',
    )
  if (schema.format)
    parts.push(
      `${schema.format === 'date-time' ? 'UTC ISO 8601 timestamp' : cell(schema.format)}.`,
    )
  if (schema.pattern && !schema.format)
    parts.push(`Pattern: ${code(schema.pattern)}.`)
  for (const [minimum, maximum, unit] of [
    [schema.minLength, schema.maxLength, 'characters'],
    [schema.minItems, schema.maxItems, 'items'],
    [
      schema.minimum,
      schema.maximum === Number.MAX_SAFE_INTEGER ? undefined : schema.maximum,
      '',
    ],
  ] as const) {
    if (minimum !== undefined || maximum !== undefined)
      parts.push(
        `${minimum !== undefined ? `Min ${minimum}` : ''}${minimum !== undefined && maximum !== undefined ? '; ' : ''}${maximum !== undefined ? `max ${maximum}` : ''}${unit ? ` ${unit}` : ''}.`,
      )
  }
  if (schema.exclusiveMinimum !== undefined)
    parts.push(`Greater than ${schema.exclusiveMinimum}.`)
  if (schema.items && !schema.items.properties && !schema.items.oneOf) {
    const itemNotes = notes(schema.items)
    if (itemNotes !== '—') parts.push(`Each item: ${itemNotes}`)
  }
  if (schema.anyOf || schema.oneOf) {
    const alternatives = [
      ...new Set(
        (schema.anyOf ?? schema.oneOf)!
          .map(notes)
          .filter((note) => note !== '—'),
      ),
    ]
    if (alternatives.length) parts.push(alternatives.join(' or '))
  }
  return parts.filter(Boolean).join(' ') || '—'
}
function fields(schema: Schema, prefix = '', condition = ''): string[][] {
  const rows: string[][] = []
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    const field = prefix ? `${prefix}.${name}` : name
    rows.push([
      code(field),
      code(type(property)),
      (schema.required?.includes(name) ? 'Yes' : 'No') + condition,
      notes(property),
    ])
    rows.push(...fields(property, field, condition))
    if (property.items)
      rows.push(...fields(property.items, `${field}[]`, condition))
    if (
      property.additionalProperties &&
      typeof property.additionalProperties === 'object'
    )
      rows.push([
        code(`${field}.*`),
        code(type(property.additionalProperties)),
        'No',
        notes(property.additionalProperties),
      ])
  }
  for (const variant of schema.oneOf ?? schema.anyOf ?? []) {
    const discriminator = variant.properties?.type?.const
    rows.push(
      ...fields(
        variant,
        prefix,
        discriminator ? ` when type=${code(discriminator)}` : condition,
      ),
    )
  }
  return rows
}
function table(rows: string[][], firstColumn = 'Field') {
  return rows.length
    ? `| ${firstColumn} | Type | Required | Details |\n| --- | --- | --- | --- |\n` +
        rows.map((row) => `| ${row.join(' | ')} |`).join('\n') +
        '\n'
    : 'None.\n'
}
function role(operation: PublicApiOperation) {
  const scopeRole =
    apiScopeDefinitions[operation.scope as keyof typeof apiScopeDefinitions]
      .minimumRole
  return Math.max(apiRoleRank[scopeRole], apiRoleRank[operation.minimumRole]) >=
    apiRoleRank.admin
    ? 'Owner/admin'
    : 'Team member'
}
function endpoint(operation: PublicApiOperation) {
  const input = z.toJSONSchema(operation.input, { io: 'input' }) as Schema
  const pathNames = Object.keys(input.properties ?? {}).filter((name) =>
    operation.path.includes(`{${name}}`),
  )
  const body = {
    ...input,
    properties: Object.fromEntries(
      Object.entries(input.properties ?? {}).filter(
        ([name]) => !pathNames.includes(name) && name !== 'idempotencyKey',
      ),
    ),
  }
  return (
    `## ${title(operation)}\n\n${code(`${operation.method} /api/v1${operation.path}`)}\n\n${operation.description}\n\n**Permission:** ${code(operation.scope)} · ${role(operation)}${operation.requiresWholeTeam ? ' · Workspace-wide access required' : ''}.\n\n**MCP:** ${operation.mcp ? `[${code(operation.id)}](/docs/mcp-tools/#${operation.id})` : 'Not exposed'}.\n\n` +
    (pathNames.length
      ? '**Path parameters**\n\n' +
        table(
          fields({
            ...input,
            properties: Object.fromEntries(
              pathNames.map((name) => [name, input.properties![name]!]),
            ),
          }),
        ) +
        '\n'
      : '') +
    (operation.readOnly ? '**Query parameters**' : '**JSON body**') +
    '\n\n' +
    table(fields(body)) +
    '\n' +
    (!operation.readOnly
      ? `Send ${code('Idempotency-Key')} as a header, not a body field.\n\n`
      : '') +
    `**Response:** HTTP ${operation.status}.\n\n` +
    table(
      fields(z.toJSONSchema(operation.output, { io: 'output' }) as Schema),
    ) +
    '\n'
  )
}
function createApiReference() {
  const documents: Record<string, string> = {}
  let index =
    '---\ndescription: Every REST endpoint, required permission and corresponding MCP tool.\n---\n\n# API reference\n\nBase URL: **`https://app.devpu.sh/api/v1`**. For self-hosting, replace the host with your dashboard URL. Authenticate with a bearer API key; see the [API guide](/docs/api/) for setup, errors, pagination and retries.\n\nSelect an endpoint below for its inputs and response fields. Tables use `[]` for array items and `.*` for record keys. A nested field is required only when its parent object or variant is present. Unknown request fields are rejected.\n\nThe [OpenAPI JSON](https://app.devpu.sh/api/v1/openapi.json) is also available for scripts and code generation.\n\n'
  const tools =
    '---\ndescription: All MCP tool names, arguments, permissions and results.\n---\n\n# MCP tools\n\n[Connect your assistant](/docs/mcp/) and select its permissions first. Each tool below lists its arguments and links to the full input constraints and JSON result.\n\nArguments are one JSON object, combining REST path, query and body fields. Use `idempotencyKey` for writes. Argument tables show required fields, defaults and confirmation values. Deployment, backup and restore calls queue work: follow the returned resource/job ID to check success.\n\n'
  let toolIndex = '## Tool index\n\n'
  let toolDetails = ''
  for (const group of [
    ...groups,
    { slug: 'api-operations', title: 'Identity', match: /^get_identity$/ },
  ]) {
    const operations = publicApiOperations.filter((operation) =>
      group.slug === 'api-operations'
        ? !groupFor(operation)
        : groupFor(operation)?.slug === group.slug,
    )
    index +=
      `## ${group.title}\n\n| Endpoint | Permission | MCP tool |\n| --- | --- | --- |\n` +
      operations
        .map(
          (operation) =>
            `| [${code(`${operation.method} /api/v1${operation.path}`)}](${link(operation)}) | ${code(operation.scope)} | ${operation.mcp ? `[${code(operation.id)}](/docs/mcp-tools/#${operation.id})` : '—'} |`,
        )
        .join('\n') +
      '\n\n'
    if (group.slug !== 'api-operations')
      documents[`${group.slug}.md`] =
        `---\ndescription: ${group.title} endpoints, input fields and response shapes.\n---\n\n# ${group.title} API\n\nSee the [API guide](/docs/api/) for authentication and retries, or the [endpoint index](/docs/api-operations/) for other resources. All paths below are relative to your dashboard host.\n\n` +
        operations.map(endpoint).join('')
    else index += operations.map(endpoint).join('')
    const available = operations.filter((operation) => operation.mcp)
    if (!available.length) continue
    toolIndex +=
      `**${group.title}**\n\n| Tool | Purpose |\n| --- | --- |\n` +
      available
        .map(
          (operation) =>
            `| [${code(operation.id)}](#${operation.id}) | ${cell(operation.description.split('. ')[0]!.replace(/\.$/, ''))} |`,
        )
        .join('\n') +
      '\n\n'
    toolDetails += `## ${group.title}\n\n`
    for (const operation of available) {
      const input =
        operation.destructive && !('confirmation' in operation.input.shape)
          ? operation.input.extend({ confirmation: z.literal(operation.id) })
          : operation.input
      toolDetails +=
        `### ${operation.id}\n\n${operation.description}\n\n**Permission:** ${code(operation.scope)} · ${role(operation)}${operation.requiresWholeTeam ? ' · Workspace-wide access required' : ''}.\n\n` +
        table(
          Object.entries(input.shape).map(([name, schema]) => {
            const json = z.toJSONSchema(schema, { io: 'input' }) as Schema
            const details = {
              ...(json.description ? { description: json.description } : {}),
              ...('default' in json ? { default: json.default } : {}),
              ...('const' in json ? { const: json.const } : {}),
              ...(json.enum ? { enum: json.enum } : {}),
            }
            return [
              code(name),
              code(type(json)),
              schema.isOptional() ? 'No' : 'Yes',
              notes(details),
            ]
          }),
          'Argument',
        ) +
        `\n[Full inputs and result](${link(operation)}).\n\n`
    }
  }
  documents['api-operations.md'] = index
  documents['mcp-tools.md'] = tools + toolIndex + toolDetails
  return Object.fromEntries(
    Object.entries(documents).map(([name, content]) => [
      name,
      content.trimEnd() + '\n',
    ]),
  )
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const check = process.argv.includes('--check')
  for (const [name, content] of Object.entries(createApiReference())) {
    const path = new URL(`../../docs/${name}`, import.meta.url)
    if (check) {
      if (readFileSync(path, 'utf8') !== content)
        throw new Error(`Stale reference: ${name}. Run pnpm docs:api.`)
    } else writeFileSync(path, content)
  }
  console.log(
    check
      ? 'API/MCP references match the operation schemas.'
      : 'Generated API/MCP Markdown references.',
  )
}
