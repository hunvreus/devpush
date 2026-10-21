import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InputGroupButton } from '@/components/ui/input-group'

export function CopyButton({
  value,
  label,
  size,
  inputGroup = false,
  disabled = false,
  children,
  className,
}: {
  value: string
  label: string
  size?: 'icon-xs' | 'icon-sm'
  inputGroup?: boolean
  disabled?: boolean
  children?: ReactNode
  className?: string
}) {
  const [feedback, setFeedback] = useState<{
    status: 'copied' | 'failed'
    attempt: number
  } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!feedback) return
    const timer = setTimeout(() => {
      setFeedback(null)
    }, 1500)
    return () => clearTimeout(timer)
  }, [feedback])
  const feedbackLabel =
    feedback?.status === 'copied'
      ? 'Copied'
      : feedback?.status === 'failed'
        ? 'Unable to copy'
        : 'Copy'
  const Control = inputGroup ? InputGroupButton : Button
  async function copy() {
    setBusy(true)
    try {
      await navigator.clipboard.writeText(value)
      setFeedback((previous) => ({
        status: 'copied',
        attempt: (previous?.attempt ?? 0) + 1,
      }))
    } catch {
      setFeedback((previous) => ({
        status: 'failed',
        attempt: (previous?.attempt ?? 0) + 1,
      }))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Control
      type="button"
      variant="ghost"
      size={children ? 'sm' : (size ?? (inputGroup ? 'icon-xs' : 'icon-sm'))}
      className={className}
      disabled={disabled || busy}
      aria-label={feedback ? feedbackLabel : label}
      onClick={() => void copy()}
    >
      {children}
      {feedback?.status === 'copied' ? <CheckIcon /> : <CopyIcon />}
    </Control>
  )
}
