import { Link } from '@tanstack/react-router'
import { ArrowLeftIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { SectionNavigation } from '@/components/section-navigation'
import type { SectionNavigationItem } from '@/components/section-navigation'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export function StandaloneSettingsLayout({
  ariaLabel,
  busy = false,
  children,
  navigation,
  title,
}: {
  ariaLabel?: string
  busy?: boolean
  children: ReactNode
  navigation: Array<SectionNavigationItem>
  title: string
}) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div
        className="mx-auto w-full max-w-screen-xl space-y-8 p-8"
        aria-busy={busy || undefined}
        aria-label={ariaLabel}
      >
        <header className="flex items-center gap-x-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild variant="outline" size="icon-sm">
                <Link to="/" aria-label="Back to home">
                  <ArrowLeftIcon />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Back to home</TooltipContent>
          </Tooltip>
          <h1 className="text-2xl font-medium">{title}</h1>
        </header>
        <div className="flex flex-row-reverse gap-x-8">
          <SectionNavigation
            className="sticky top-8 hidden h-full min-w-64 lg:flex"
            items={navigation}
          />
          <div className="w-full min-w-0 flex-1 space-y-8">{children}</div>
        </div>
      </div>
    </main>
  )
}

export function SettingsLayout({
  children,
  navigation,
}: {
  children: ReactNode
  navigation: Array<SectionNavigationItem>
}) {
  return (
    <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_240px]">
      <div className="min-w-0 space-y-8">{children}</div>
      <aside className="hidden lg:block">
        <SectionNavigation className="sticky top-[122px]" items={navigation} />
      </aside>
    </div>
  )
}

export function SettingsSection({
  children,
  contentClassName,
  description,
  footer,
  id,
  title,
}: {
  children: ReactNode
  contentClassName?: string
  description: ReactNode
  footer?: ReactNode
  id: string
  title: string
}) {
  return (
    <Card id={id} className="scroll-mt-8">
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
      {footer ? (
        <CardFooter className="justify-end gap-x-2">{footer}</CardFooter>
      ) : null}
    </Card>
  )
}
