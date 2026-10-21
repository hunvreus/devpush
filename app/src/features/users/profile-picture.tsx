import { useRef, useState } from 'react'
import {
  ImageUpIcon,
  LoaderCircleIcon,
  Trash2Icon,
  Undo2Icon,
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip'

export function ProfilePicture({
  image,
  name,
  email,
  disabled,
  processing,
  onFile,
  onChange,
  id = 'profile-picture',
}: {
  image: string | null
  name: string
  email: string
  disabled: boolean
  processing: boolean
  onFile: (file: File) => Promise<void>
  onChange: (image: string | null) => void
  id?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const uploading = useRef(false)
  const [removed, setRemoved] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const locked = disabled || processing
  const upload = async (file: File) => {
    if (locked || uploading.current) return
    uploading.current = true
    try {
      await onFile(file)
      setRemoved(null)
    } finally {
      uploading.current = false
    }
  }
  return (
    <TooltipProvider>
      <div className="flex items-center gap-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              id={id}
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Upload profile picture"
              aria-busy={processing}
              disabled={locked}
              className="group/picture relative size-9 rounded-full border-0 p-0 hover:bg-transparent"
              data-active={dragging || processing}
              onClick={() => input.current?.click()}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes('Files')) return
                event.preventDefault()
                event.dataTransfer.dropEffect = locked ? 'none' : 'copy'
                if (!locked) setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                if (!event.dataTransfer.types.includes('Files')) return
                event.preventDefault()
                setDragging(false)
                if (!locked && event.dataTransfer.files.length === 1) {
                  const file = event.dataTransfer.files[0]
                  if (file) void upload(file)
                }
              }}
            >
              <Avatar className="pointer-events-none size-9">
                <AvatarImage
                  src={image ?? undefined}
                  alt={name || email}
                  referrerPolicy="no-referrer"
                  draggable={false}
                />
                <AvatarFallback>
                  {(name || email).trim().slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="pointer-events-none absolute inset-0 grid place-items-center rounded-full bg-background/60 text-foreground opacity-0 transition-opacity group-hover/picture:opacity-100 group-focus-visible/picture:opacity-100 group-data-[active=true]/picture:opacity-100">
                {processing ? (
                  <LoaderCircleIcon className="size-4 animate-spin opacity-60" />
                ) : (
                  <ImageUpIcon className="size-4 opacity-50" />
                )}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Upload or drop a picture</TooltipContent>
        </Tooltip>
        <input
          ref={input}
          type="file"
          aria-label="Avatar image"
          accept="image/png,image/jpeg,image/webp"
          disabled={locked}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void upload(file)
          }}
        />
        {image || removed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={locked}
                aria-label={image ? 'Remove picture' : 'Reset picture'}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => {
                  if (image) {
                    setRemoved(image)
                    onChange(null)
                  } else {
                    onChange(removed)
                    setRemoved(null)
                  }
                }}
              >
                {image ? <Trash2Icon /> : <Undo2Icon />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {image ? 'Remove picture' : 'Reset picture'}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </TooltipProvider>
  )
}
