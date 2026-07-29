'use client'

/**
 * The offer that turns a page selection into a result-set selection.
 *
 * Without it, `⌘A` and the header checkbox both mean "the 25 rows I can see",
 * which is almost never what somebody filtering a list of three hundred wants
 * — and there is no other way to ask for the rest. The banner appears only
 * when the distinction actually exists: every row on the page is selected and
 * more rows match.
 *
 * It is a sentence with a link, not a button with a label, because the numbers
 * are the whole message. "Select all" tells you nothing; "select all 312
 * matching" tells you what you are about to act on.
 */
export function SelectAllBanner({ pageCount, total, allMatching, onSelectAll, onClear }: {
  pageCount: number
  total: number
  allMatching: boolean
  onSelectAll: () => void
  onClear: () => void
}) {
  if (total <= pageCount) return null

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-2 border-b border-line-subtle bg-surface-subtle px-6 py-2.5 text-caption text-content-secondary"
    >
      {allMatching ? (
        <>
          <span>
            All <strong className="tabular-nums text-content-primary">{total.toLocaleString('en-GB')}</strong> matching
            rows are selected.
          </span>
          <button
            type="button"
            onClick={onClear}
            className="font-semibold text-content-accent hover:underline"
          >
            Clear the selection
          </button>
        </>
      ) : (
        <>
          <span>
            All <strong className="tabular-nums text-content-primary">{pageCount}</strong> on this page are selected.
          </span>
          <button
            type="button"
            onClick={onSelectAll}
            className="font-semibold text-content-accent hover:underline"
          >
            Select all {total.toLocaleString('en-GB')} that match
          </button>
        </>
      )}
    </div>
  )
}
