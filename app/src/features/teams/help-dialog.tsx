import { LogoMark } from '@/components/logo-mark'
import { CircleQuestionMarkIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import packageJson from '../../../package.json'

const links = [
  { label: 'Website', href: 'https://devpu.sh', text: 'devpu.sh' },
  {
    label: 'Documentation',
    href: 'https://devpu.sh/docs',
    text: 'Documentation',
  },
  {
    label: 'GitHub',
    href: 'https://github.com/hunvreus/devpush',
    text: 'hunvreus/devpush',
  },
  { label: 'Community', href: 'https://devpu.sh/chat', text: 'devpu.sh/chat' },
]

export function HelpDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Help">
          <CircleQuestionMarkIcon />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader className="items-center gap-3 text-center sm:text-center">
          <div className="flex size-15 shrink-0 items-center justify-center rounded-2xl bg-orange-500 text-black">
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
