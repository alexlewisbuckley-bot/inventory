import { cn } from '@/lib/cn'

const SIZES = { sm: 'h-7 w-7 text-micro', md: 'h-9 w-9 text-caption', lg: 'h-12 w-12 text-body' } as const

/**
 * Initials avatar. The background hue is derived from the user id so the same
 * person is always the same colour without storing a preference.
 */
export function Avatar({ initials, id, size = 'md', className }: {
  initials: string; id?: string; size?: keyof typeof SIZES; className?: string
}) {
  const hue = id ? [...id].reduce((a, c) => (a + c.charCodeAt(0)) % 360, 0) : 214
  return (
    <span
      className={cn('inline-flex items-center justify-center rounded-full font-bold text-white select-none', SIZES[size], className)}
      style={{ backgroundColor: `hsl(${hue} 45% 32%)` }}
      aria-hidden
    >
      {initials}
    </span>
  )
}
