import { LogoMark } from '@/components/logo-mark'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import packageJson from '../../../package.json'

const links = [
  { label: 'Website', href: 'https://devpu.sh', text: 'devpu.sh' },
  {
    label: 'Documentation',
    href: 'https://devpu.sh/docs',
    text: 'devpu.sh/docs',
  },
  { label: 'Discord', href: 'https://devpu.sh/chat', text: 'devpu.sh/chat' },
  {
    label: 'GitHub',
    href: 'https://github.com/hunvreus/devpush',
    text: 'hunvreus/devpush',
  },
]

export function HelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[22rem]">
        <DialogHeader className="items-center gap-3 text-center sm:text-center">
          <div className="flex size-15 shrink-0 items-center justify-center rounded-lg bg-orange-600 text-white">
            <LogoMark className="size-9 shrink-0" />
          </div>
          <DialogTitle>devpush</DialogTitle>
          <DialogDescription>
            Deploy your applications on your own servers.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border text-sm">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <span className="text-muted-foreground">Version</span>
            <span>{packageJson.version}</span>
          </div>
          {links.map(({ label, href, text }) => (
            <div
              key={label}
              className="flex items-center justify-between gap-3 border-b px-4 py-3 last:border-b-0"
            >
              <span className="text-muted-foreground">{label}</span>
              <a
                className="inline-flex items-center gap-2 hover:underline"
                href={href}
                target="_blank"
                rel="noreferrer noopener"
              >
                {text}
              </a>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
