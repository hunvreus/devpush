import { InfoIcon } from 'lucide-react'
import { Alert, AlertDescription } from '#devpush/components/ui/alert'

export function SignInMessage({ message }: { message: string }) {
  if (!message.trim()) return null
  // Render text only. Recognize explicit web URLs, never HTML or arbitrary schemes.
  const parts = message.split(/(https?:\/\/[^\s<>]+)/g)
  return (
    <Alert role="note">
      <InfoIcon aria-hidden="true" />
      <AlertDescription className="whitespace-pre-line [overflow-wrap:anywhere]">
        {parts.map((part, index) => {
          if (!/^https?:\/\//.test(part)) return part
          const url = part.replace(/[.,;:!?)]+$/, '')
          return (
            <span key={index}>
              <a
                className="underline underline-offset-4 hover:text-foreground"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {url}
              </a>
              {part.slice(url.length)}
            </span>
          )
        })}
      </AlertDescription>
    </Alert>
  )
}
