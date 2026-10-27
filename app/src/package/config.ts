import type { DevpushPlugin } from './plugins'

export interface DevpushOptions {
  /** Consumer project directory. Defaults to process.cwd(). */
  root?: string
  plugins?: readonly DevpushPlugin[]
  target?: 'node' | 'cloudflare'
  /** Wrangler configuration owned by the consumer. */
  wranglerConfig?: string
}
