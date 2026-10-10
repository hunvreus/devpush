import { z } from 'zod'

const routeSchema = z.object({
  service: z
    .string()
    .trim()
    .min(1, 'Enter a service name.')
    .regex(
      /^[A-Za-z0-9._-]+$/,
      'Route services can only contain letters, numbers, dots, underscores, and hyphens.',
    ),
  port: z
    .number()
    .int('Enter a whole-number port.')
    .min(1, 'Route ports must be between 1 and 65535.')
    .max(65535, 'Route ports must be between 1 and 65535.'),
  path: z
    .string()
    .trim()
    .min(1, 'Enter a route path.')
    .regex(/^\//, 'Route paths must start with /.')
    .regex(/^[^\s`]+$/, 'Route paths cannot contain spaces or ` characters.'),
  stripPrefix: z.boolean().optional().default(false),
  environmentId: z.string().trim().min(1).optional(),
})

const domainSchema = z.object({
  host: z
    .string()
    .toLowerCase()
    .trim()
    .min(1, 'Enter a domain hostname.')
    .max(253, 'Hostnames must be 253 characters or fewer.')
    .regex(
      /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*$/,
      'Domains must be valid DNS hostnames without protocol, path, wildcard, or port.',
    ),
  environmentId: z.string().trim().min(1),
  basePath: z.string().trim(),
  https: z.boolean(),
})

export const projectRoutesSchema = z.object({
  teamSlug: z.string().min(1),
  projectName: z.string().min(1),
  routes: z.array(routeSchema).superRefine((routes, ctx) => {
    const seen = new Set<string>()
    routes.forEach((route, index) => {
      const key = JSON.stringify([route.environmentId ?? null, route.path])
      if (seen.has(key))
        ctx.addIssue({
          code: 'custom',
          path: [index, 'path'],
          message: 'Each route path can only be configured once per scope.',
        })
      seen.add(key)
    })
  }),
})

export const projectDomainsSchema = z.object({
  teamSlug: z.string().min(1),
  projectName: z.string().min(1),
  domains: z.array(domainSchema).superRefine((domains, ctx) => {
    const seen = new Set<string>()
    domains.forEach((domain, index) => {
      if (seen.has(domain.host))
        ctx.addIssue({
          code: 'custom',
          path: [index, 'host'],
          message: 'Each domain can only be added once.',
        })
      seen.add(domain.host)
    })
  }),
})
