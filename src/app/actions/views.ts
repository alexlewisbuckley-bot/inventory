'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/server/auth/session'
import {
  createView, deleteView, renameView, setViewShared, updateViewQuery,
} from '@/server/services/views-service'
import { SAVED_VIEW_OBJECTS, type SavedViewObject } from '@/lib/enums'
import { isAppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import type { ActionState } from './auth'

/**
 * Saved views.
 *
 * Deliberately not permission-gated beyond being signed in. A view is a
 * bookmark on a list somebody can already see — the list itself enforces what
 * they may read, and a saved view carrying a filter they lack the rights for
 * simply returns nothing. Requiring a capability to bookmark a page you are
 * allowed to open would be ceremony with no security value.
 */

function toState(error: unknown, fallback: string): ActionState {
  if (isAppError(error)) {
    return {
      ok: false,
      message: error.message,
      errors: error.details as Record<string, string> | undefined,
    }
  }
  logger.error(fallback, { error: (error as Error).message })
  return { ok: false, message: fallback }
}

const revalidateLists = () => {
  for (const path of ['/inventory', '/customers', '/sales']) revalidatePath(path)
}

export async function saveViewAction(
  object: string,
  name: string,
  query: string,
  shared = false,
): Promise<ActionState> {
  const actor = await requireUser()
  if (!SAVED_VIEW_OBJECTS.includes(object as SavedViewObject)) {
    return { ok: false, message: 'That is not a list a view can belong to.' }
  }
  try {
    const id = await createView({ object: object as SavedViewObject, name, query, shared }, actor)
    revalidateLists()
    return { ok: true, message: `“${name.trim()}” saved.`, id }
  } catch (error) {
    return toState(error, 'Could not save that view.')
  }
}

export async function renameViewAction(id: string, name: string): Promise<ActionState> {
  const actor = await requireUser()
  try {
    await renameView(id, name, actor)
    revalidateLists()
    return { ok: true, message: 'Renamed.' }
  } catch (error) {
    return toState(error, 'Could not rename that view.')
  }
}

export async function updateViewQueryAction(id: string, query: string): Promise<ActionState> {
  const actor = await requireUser()
  try {
    await updateViewQuery(id, query, actor)
    revalidateLists()
    return { ok: true, message: 'View updated to match what you are looking at.' }
  } catch (error) {
    return toState(error, 'Could not update that view.')
  }
}

export async function setViewSharedAction(id: string, shared: boolean): Promise<ActionState> {
  const actor = await requireUser()
  try {
    await setViewShared(id, shared, actor)
    revalidateLists()
    return { ok: true, message: shared ? 'Shared with the team.' : 'Made private again.' }
  } catch (error) {
    return toState(error, 'Could not change who can see that view.')
  }
}

export async function deleteViewAction(id: string): Promise<ActionState> {
  const actor = await requireUser()
  try {
    await deleteView(id, actor)
    revalidateLists()
    return { ok: true, message: 'View deleted.' }
  } catch (error) {
    return toState(error, 'Could not delete that view.')
  }
}
