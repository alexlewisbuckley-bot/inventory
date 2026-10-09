'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Camera, Download, Handshake } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Card, CardBody, TextField } from '@/components/ui'
import { photographName } from '@/lib/photo-name'
import type { PhotographedWatch } from '@/server/services/image-service'

/**
 * Every photograph in the system, filed under the serial of the watch in it.
 *
 * The stock list answers "what do we hold"; this answers "where is the
 * picture of that one, and what is it called". The caption under each
 * photograph is the filename it downloads as, shown rather than hidden,
 * because the whole value of the page is knowing that before you click.
 */
export function WatchImageWall({ watches }: { watches: PhotographedWatch[] }) {
  const [query, setQuery] = useState('')

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return watches
    return watches.filter((w) => [
      w.serial, String(w.stockNo), w.brandName, w.model, w.nickname,
    ].some((field) => field?.toLowerCase().includes(needle)))
  }, [watches, query])

  const photographs = shown.reduce((n, w) => n + w.photographs.length, 0)
  const unnamed = watches.filter((w) => !w.serial?.trim()).length

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <TextField
            label="Find a watch"
            className="sm:max-w-sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Serial, stock number, reference or model"
          />
          <p className="text-small text-content-secondary">
            <b className="tabular-nums text-content-primary">{photographs}</b>
            {photographs === 1 ? ' photograph' : ' photographs'} of{' '}
            <b className="tabular-nums text-content-primary">{shown.length}</b>
            {shown.length === 1 ? ' watch' : ' watches'}
            {unnamed > 0 && !query && (
              // Said plainly rather than left to be discovered one download at
              // a time: these are the ones that will come out as stock-1143.
              <span className="block text-caption text-content-muted">
                {unnamed} {unnamed === 1 ? 'has' : 'have'} no serial recorded yet
              </span>
            )}
          </p>
        </CardBody>
      </Card>

      {shown.length === 0 ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-2 py-12 text-content-muted">
            <Camera className="h-7 w-7" aria-hidden />
            <p className="text-small font-semibold">
              {watches.length === 0
                ? 'No watch has a photograph yet'
                : 'Nothing matches that'}
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {shown.map((watch) => (
            <WatchRow key={watch.id} watch={watch} />
          ))}
        </div>
      )}
    </div>
  )
}

function WatchRow({ watch }: { watch: PhotographedWatch }) {
  const total = watch.photographs.length
  return (
    <section aria-label={`Stock ${watch.stockNo}`}>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link
          href={`/inventory?watch=${watch.id}`}
          className="text-small font-bold text-content-primary hover:underline"
        >
          {watch.brandName} {watch.nickname ?? watch.model}
        </Link>
        <span className="font-mono text-caption text-content-secondary">
          {watch.serial?.trim()
            ? watch.serial
            : <span className="text-content-muted">no serial · stock {watch.stockNo}</span>}
        </span>
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {watch.photographs.map((photograph, index) => {
          const name = photographName({
            serial: watch.serial,
            stockNo: watch.stockNo,
            index,
            total,
            mimeType: photograph.mimeType,
          })
          return (
            <li key={photograph.id}>
              {/*
                A plain anchor with `download`, not a button and not a route:
                the file is already served from this origin, so the browser
                saves it under the name given here and nothing has to be
                re-encoded or proxied to rename it.
              */}
              <a
                href={`/api/images/${photograph.id}`}
                download={name}
                className="group block"
                title={`Download as ${name}`}
              >
                <div className="relative overflow-hidden rounded-md border border-line-subtle bg-surface-subtle">
                  <img
                    src={`/api/images/${photograph.id}`}
                    alt={`${watch.brandName} ${watch.model}, ${name}`}
                    loading="lazy"
                    decoding="async"
                    className="aspect-square w-full object-cover transition-transform group-hover:scale-[1.02]"
                  />
                  {photograph.kind === 'TRADE' && (
                    <span
                      className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-sm bg-surface-raised/95 px-1.5 py-0.5 text-micro font-semibold text-content-secondary"
                      title="Trade photograph — never published"
                    >
                      <Handshake className="h-3 w-3" aria-hidden />
                      Trade
                    </span>
                  )}
                  <span className="absolute bottom-1.5 right-1.5 rounded-sm bg-surface-raised/95 p-1 text-content-secondary opacity-0 transition-opacity group-hover:opacity-100">
                    <Download className="h-3.5 w-3.5" aria-hidden />
                  </span>
                </div>
                <p className={cn(
                  'mt-1 truncate font-mono text-micro',
                  watch.serial?.trim() ? 'text-content-secondary' : 'text-content-muted',
                )}>
                  {name}
                </p>
              </a>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
