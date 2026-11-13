'use client'
import { Check } from 'lucide-react'

/**
 * One watch, as a card.
 *
 * The same card on both outside-facing pages. They had drifted — different
 * image padding, different type sizes, a four-line name on one and a
 * two-line name on the other — which is why the campaign page read as a
 * different product from the portal. One component, one set of decisions.
 *
 * Every card is the same height whatever its name runs to: the picture is a
 * fixed square, the name is held to two lines, the details to one, and
 * whatever the page puts at the bottom is pushed there. Without that, a watch
 * called "Royal Oak Offshore Chronograph" drops the button on its card below
 * the four beside it and the row reads as broken.
 */
export function WatchCard({ title, details, imageSrc, selected, onSelect, children }: {
  title: string
  details: string
  imageSrc: string | null
  selected?: boolean
  onSelect?: () => void
  /** The price block and the button — the part each page decides for itself. */
  children: React.ReactNode
}) {
  return (
    <li className="group relative flex h-full flex-col">
      {onSelect && (
        /*
          * The tick, top-left of the picture.
          *
          * Always there once something is selected, and on hover otherwise: a
          * checkbox on every card all the time turns a shop into a
          * spreadsheet, and one that only appears on hover is invisible on a
          * phone.
          */
        <button
          type="button"
          aria-pressed={selected}
          aria-label={`Select ${title}`}
          onClick={onSelect}
          className={`absolute left-2 top-2 z-10 flex h-7 w-7 items-center justify-center border transition-opacity ${
            selected
              ? 'border-transparent opacity-100'
              : 'border-black/20 bg-white/90 opacity-0 group-hover:opacity-100 focus:opacity-100'
          }`}
          style={selected ? { backgroundColor: 'var(--brand)', color: '#fff' } : undefined}
        >
          {selected && <Check className="h-4 w-4" aria-hidden />}
        </button>
      )}

      <div
        className={`aspect-square w-full overflow-hidden bg-black/[0.02] ${selected ? 'ring-2 ring-offset-1' : ''}`}
        style={selected ? { ['--tw-ring-color' as string]: 'var(--brand)' } : undefined}
      >
        {imageSrc && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={imageSrc}
            alt={title}
            loading="lazy"
            // Contained, not cropped: these are packshots of different shapes,
            // and cropping them to a square takes the lugs off a dress watch
            // to make it fill a box.
            className="h-full w-full object-contain p-3 mix-blend-multiply"
          />
        )}
      </div>

      <p className="mt-3 line-clamp-2 min-h-[2.6em] font-serif text-[15.5px] leading-snug text-black">
        {title}
      </p>
      <p className="mt-0.5 line-clamp-1 min-h-[1.3em] text-[12px] text-black/50">{details}</p>

      {/* Pushed to the bottom, so a row of cards shares one line of buttons. */}
      <div className="mt-auto pt-2">{children}</div>
    </li>
  )
}

/** The grid they sit in. Five to a row where there is room for five. */
export function WatchGrid({ children }: { children: React.ReactNode }) {
  return (
    <ul className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {children}
    </ul>
  )
}
