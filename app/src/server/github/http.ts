import { readRequestText } from '#devpush/server/http/request-body'
/** Fixed-provider requests must not hold auth, enrollment or scheduler work indefinitely. */
export function fetchGitHub(url: string, init: RequestInit = {}) {
  const timeout = AbortSignal.timeout(10_000)
  return fetch(url, {
    ...init,
    signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
  })
}

/** GitHub pages/contents have known sizes; never buffer an unlimited provider body. */
export async function readGitHubJson<T>(response: Response): Promise<T> {
  return JSON.parse(await readRequestText(response, 4 * 1024 * 1024)) as T
}
