export function LogoMark({
  className = 'size-4 shrink-0',
}: {
  className?: string
}) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path d="m16 6 6 6-6 6" />
      <path d="M7 3 2 21M4.5 12H22" />
    </svg>
  )
}
