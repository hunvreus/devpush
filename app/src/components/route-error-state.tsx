import { publicErrorMessages } from '#devpush/lib/public-error'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { ArrowLeftIcon } from 'lucide-react'

import { Button } from '#devpush/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '#devpush/components/ui/empty'

export function RouteNotFoundState({
  description,
  title,
}: {
  description: string
  title: string
}) {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Empty className="max-w-md border-0">
        <EmptyHeader>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild variant="outline">
            <a href="/">
              <ArrowLeftIcon data-icon="inline-start" />
              Go home
            </a>
          </Button>
        </EmptyContent>
      </Empty>
    </main>
  )
}

export function RouteErrorState({ error }: ErrorComponentProps) {
  const pathname =
    typeof window === 'undefined' ? null : window.location.pathname

  if (isNotFoundError(error)) {
    return (
      <RouteNotFoundState
        title="Not found"
        description="The team, project, or resource you requested does not exist, or you do not have access."
      />
    )
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Empty className="max-w-md border-0">
        <EmptyHeader>
          <EmptyTitle>Something went wrong</EmptyTitle>
          <EmptyDescription>
            The app hit an unexpected error while loading this page.
          </EmptyDescription>
        </EmptyHeader>
        {pathname !== '/' ? (
          <EmptyContent>
            <Button asChild variant="outline">
              <a href="/">
                <ArrowLeftIcon data-icon="inline-start" />
                Go home
              </a>
            </Button>
          </EmptyContent>
        ) : null}
      </Empty>
    </main>
  )
}

function isNotFoundError(error: unknown) {
  // Server actions serialize PublicError as a plain object, not an Error instance.
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.endsWith('_NOT_FOUND') &&
    Object.hasOwn(publicErrorMessages, error.code)
  )
    return true

  if (!(error instanceof Error)) {
    return false
  }

  return /\bnot found\.?$/i.test(error.message)
}
