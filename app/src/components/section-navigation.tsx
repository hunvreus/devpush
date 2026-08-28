import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type SectionNavigationItem = {
  href: `#${string}`
  label: string
  destructive?: boolean
}

export function SectionNavigation({
  className,
  items,
}: {
  className?: string
  items: Array<SectionNavigationItem>
}) {
  return (
    <nav
      aria-label="Page sections"
      className={cn('flex flex-col gap-y-1', className)}
    >
      {items.map((item) => (
        <Button
          asChild
          className={cn(
            'w-full justify-start px-2',
            item.destructive &&
              'text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20',
          )}
          key={item.href}
          size="sm"
          variant="ghost"
        >
          <a href={item.href}>{item.label}</a>
        </Button>
      ))}
    </nav>
  )
}
