/**
 * Every keyboard shortcut, declared once.
 *
 * The "?" overlay and the help page each had their own list, and they had
 * already drifted: help omitted the whole g-navigation set and listed Tab and
 * Shift-Tab, which are the browser's, not ours.
 */
export interface Shortcut {
  keys: string[]
  action: string
  group: 'General' | 'Navigation' | 'Actions'
  /** Shown under the action where the key differs by platform. */
  note?: string
}

export const SHORTCUTS: readonly Shortcut[] = [
  { keys: ['⌘', 'K'], action: 'Search stock and jump anywhere', group: 'General', note: 'Ctrl-K on Windows' },
  { keys: ['/'], action: 'Focus the search box on this page', group: 'General' },
  { keys: ['?'], action: 'Show the shortcut list', group: 'General' },
  { keys: ['['], action: 'Collapse or expand the sidebar', group: 'General' },
  { keys: ['Esc'], action: 'Close any dialog, drawer or menu', group: 'General' },
  { keys: ['N'], action: 'Add an item', group: 'Actions' },
  { keys: ['G', 'D'], action: 'Go to the dashboard', group: 'Navigation' },
  { keys: ['G', 'I'], action: 'Go to the inventory', group: 'Navigation' },
  { keys: ['G', 'S'], action: 'Go to sales', group: 'Navigation' },
  { keys: ['G', 'U'], action: 'Go to suppliers', group: 'Navigation' },
  { keys: ['G', 'L'], action: 'Go to locations', group: 'Navigation' },
  { keys: ['G', 'R'], action: 'Go to reports', group: 'Navigation' },
]

export const SHORTCUT_GROUPS = ['General', 'Navigation', 'Actions'] as const
