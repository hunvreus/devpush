export function LogoMark({
  className = 'size-4.5 shrink-0',
}: {
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 120 96"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M48 0H96L120 24V72H72V96H24L0 72V24H48V0ZM24 48V72H48V48H24ZM72 24V48H96V24H72Z"
      />
    </svg>
  )
}
