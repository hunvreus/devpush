export const maxAgentJobWaitSeconds = 20

/** Bound idle HTTP requests without caching authorization or delaying claims. */
export async function waitForAgentJob<T>(
  claim: () => Promise<T | null>,
  waitSeconds: number,
  signal: AbortSignal,
): Promise<T | null> {
  const deadline =
    Date.now() +
    Math.min(maxAgentJobWaitSeconds, Math.max(0, waitSeconds)) * 1000
  while (!signal.aborted) {
    const job = await claim()
    if (job !== null) return job
    const remaining = deadline - Date.now()
    if (remaining <= 0) return null
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', finish)
        resolve()
      }
      const timer = setTimeout(finish, Math.min(5000, remaining))
      signal.addEventListener('abort', finish, { once: true })
      if (signal.aborted) finish()
    })
    if (Date.now() >= deadline) return null
  }
  return null
}
