import { useLayoutEffect, useRef } from 'react'
import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/utils'

type LogScrollAreaProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode
  followKey: string | number
}

const bottomThreshold = 8

export function LogScrollArea({
  children,
  className,
  followKey,
  onScroll,
  ...props
}: LogScrollAreaProps) {
  const ref = useRef<HTMLDivElement>(null)
  const hasMountedRef = useRef(false)
  const isAtBottomRef = useRef(true)

  useLayoutEffect(() => {
    const element = ref.current

    if (!element) {
      return
    }

    const shouldFollow = !hasMountedRef.current || isAtBottomRef.current
    hasMountedRef.current = true

    if (!shouldFollow) {
      return
    }

    let frame = window.requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight
      frame = window.requestAnimationFrame(() => {
        element.scrollTop = element.scrollHeight
        isAtBottomRef.current = isScrolledToBottom(element)
      })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [followKey])

  return (
    <div
      {...props}
      ref={ref}
      className={cn('scrollbar overflow-y-auto', className)}
      onScroll={(event) => {
        isAtBottomRef.current = isScrolledToBottom(event.currentTarget)
        onScroll?.(event)
      }}
    >
      {children}
    </div>
  )
}

function isScrolledToBottom(element: HTMLDivElement) {
  const distanceFromBottom =
    element.scrollHeight - element.scrollTop - element.clientHeight

  return distanceFromBottom <= bottomThreshold
}
