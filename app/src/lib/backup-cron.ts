export function isCronDue(cron: string, now: Date) {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = cron.trim().split(/\s+/)

  if (
    minute === undefined ||
    hour === undefined ||
    dayOfMonth === undefined ||
    month === undefined ||
    dayOfWeek === undefined
  )
    return false

  const minuteMatches = matchesCronPart(minute, now.getUTCMinutes(), 0, 59)
  const hourMatches = matchesCronPart(hour, now.getUTCHours(), 0, 23)
  const monthMatches = matchesCronPart(month, now.getUTCMonth() + 1, 1, 12)
  const dayOfMonthMatches = matchesCronPart(dayOfMonth, now.getUTCDate(), 1, 31)
  const dayOfWeekMatches = matchesCronPart(dayOfWeek, now.getUTCDay(), 0, 7)
  const dayMatches =
    dayOfMonth === '*'
      ? dayOfWeekMatches
      : dayOfWeek === '*'
        ? dayOfMonthMatches
        : dayOfMonthMatches || dayOfWeekMatches

  return minuteMatches && hourMatches && monthMatches && dayMatches
}

export function isValidCron(cron: string) {
  const parts = cron.trim().split(/\s+/)
  const ranges = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
  ] as const

  return (
    parts.length === 5 &&
    ranges.every(([min, max], index) => {
      const part = parts[index]
      return part !== undefined && isValidCronPart(part, min, max)
    })
  )
}

function isValidCronPart(part: string, min: number, max: number) {
  return part.split(',').every((token) => {
    const segments = token.split('/')
    const base = segments[0]
    const hasStep = segments.length === 2
    if (segments.length > 2 || !base) return false

    if (hasStep) {
      const step = Number(segments[1])
      if (!Number.isInteger(step) || step < 1 || step > max - min + 1) {
        return false
      }
    }

    if (base === '*') return true

    if (base.includes('-')) {
      const range = base.split('-')
      if (range.length !== 2) return false
      const start = Number(range[0])
      const end = Number(range[1])
      return (
        Number.isInteger(start) &&
        Number.isInteger(end) &&
        start >= min &&
        end <= max &&
        start <= end
      )
    }

    const numeric = Number(base)
    return (
      !hasStep && Number.isInteger(numeric) && numeric >= min && numeric <= max
    )
  })
}

function matchesCronPart(
  part: string,
  value: number,
  min: number,
  max: number,
) {
  for (const token of part.split(',')) {
    const [base = '', rawStep] = token.split('/')
    const step = rawStep ? Number(rawStep) : 1
    let start = min
    let end = max

    if (base !== '*') {
      if (base.includes('-')) {
        const [rawStart, rawEnd] = base.split('-', 2)
        start = Number(rawStart)
        end = Number(rawEnd)
      } else {
        start = Number(base)
        end = start
      }
    }

    const normalizedValue = max === 7 && value === 0 && end === 7 ? 7 : value
    if (
      normalizedValue >= start &&
      normalizedValue <= end &&
      (normalizedValue - start) % step === 0
    ) {
      return true
    }
  }

  return false
}

/** Next matching UTC minute, skipping nonmatching days and hours. */
export function nextCronRun(cron: string, after: Date): Date | null {
  if (!isValidCron(cron)) return null
  const [minute, hour, dom, month, dow] = cron.trim().split(/\s+/) as [
    string,
    string,
    string,
    string,
    string,
  ]
  const candidate = new Date(after)
  candidate.setUTCSeconds(0, 0)
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1)
  const limitYear = candidate.getUTCFullYear() + 8
  while (candidate.getUTCFullYear() < limitYear) {
    const dayMatches =
      dom === '*'
        ? matchesCronPart(dow, candidate.getUTCDay(), 0, 7)
        : dow === '*'
          ? matchesCronPart(dom, candidate.getUTCDate(), 1, 31)
          : matchesCronPart(dom, candidate.getUTCDate(), 1, 31) ||
            matchesCronPart(dow, candidate.getUTCDay(), 0, 7)
    if (
      !matchesCronPart(month, candidate.getUTCMonth() + 1, 1, 12) ||
      !dayMatches
    ) {
      candidate.setUTCDate(candidate.getUTCDate() + 1)
      candidate.setUTCHours(0, 0, 0, 0)
      continue
    }
    if (!matchesCronPart(hour, candidate.getUTCHours(), 0, 23)) {
      candidate.setUTCHours(candidate.getUTCHours() + 1, 0, 0, 0)
      continue
    }
    if (matchesCronPart(minute, candidate.getUTCMinutes(), 0, 59))
      return candidate
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1)
  }
  return null
}
