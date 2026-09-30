'use client'
import { createContext, useContext } from 'react'
import type { Density } from '@/lib/enums'

const DensityContext = createContext<Density>('COMFORTABLE')

/**
 * The reader's own row-height preference, carried to every table.
 *
 * "Table density" has been in the profile settings, saved to the database and
 * read back into the form, since the beginning — and applied to nothing. No
 * table was ever told about it, so choosing Compact changed the stored value
 * and not one pixel of the screen. Every `Table` now takes its default from
 * here, so setting it once applies everywhere.
 */
export function DensityProvider({ value, children }: { value: Density; children: React.ReactNode }) {
  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>
}

export function useDensity(): Density {
  return useContext(DensityContext)
}
