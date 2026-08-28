import { CheckIcon } from 'lucide-react'

export const environmentColors = [
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
]

const environmentColorClasses: Record<string, string> = {
  amber: 'bg-amber-500',
  blue: 'bg-blue-500',
  cyan: 'bg-cyan-500',
  emerald: 'bg-emerald-500',
  fuchsia: 'bg-fuchsia-500',
  green: 'bg-green-500',
  indigo: 'bg-indigo-500',
  lime: 'bg-lime-500',
  orange: 'bg-orange-500',
  pink: 'bg-pink-500',
  purple: 'bg-purple-500',
  red: 'bg-red-500',
  rose: 'bg-rose-500',
  sky: 'bg-sky-500',
  teal: 'bg-teal-500',
  violet: 'bg-violet-500',
  yellow: 'bg-yellow-500',
  zinc: 'bg-zinc-500',
}

const environmentColorForegroundClasses: Record<string, string> = {
  amber: 'text-black',
  cyan: 'text-black',
  lime: 'text-black',
  sky: 'text-black',
  yellow: 'text-black',
}

export function getEnvironmentColor(index: number) {
  return environmentColors[(3 * (index - 1)) % environmentColors.length]
}

export function EnvironmentDot({
  color,
  size = 'sm',
}: {
  color?: string
  size?: 'sm' | 'md'
}) {
  return (
    <span
      className={`${size === 'md' ? 'size-3' : 'size-2.5'} shrink-0 rounded-full ${environmentColorClasses[color ?? 'zinc'] ?? environmentColorClasses.zinc}`}
    />
  )
}

export function EnvironmentColorOption({
  checked,
  color,
}: {
  checked: boolean
  color: string
}) {
  return (
    <span
      className={`flex size-5 items-center justify-center rounded-full ${environmentColorClasses[color] ?? environmentColorClasses.zinc}`}
    >
      {checked ? (
        <CheckIcon
          className={`size-3.5 ${environmentColorForegroundClasses[color] ?? 'text-white'}`}
        />
      ) : null}
    </span>
  )
}
