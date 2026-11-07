import type { MessageKey } from './i18n-dictionaries';

/** What a shortcut does. */
export type ShortcutId = 'toggleSidebar' | 'toggleSettings' | 'newTab' | 'goToTab' | 'close';

/** A global shortcut as pressed: the Workspace handles these wherever the focus is (a Terminal included). */
export type GlobalShortcut =
  | { readonly id: Exclude<ShortcutId, 'close' | 'goToTab'> }
  /** Ctrl+1–9: the Tab with that number, counted from 1. */
  | { readonly id: 'goToTab'; readonly number: number };

export interface Shortcut {
  readonly id: ShortcutId;
  /** The keys as Settings → Shortcuts shows them, in the order they are pressed. */
  readonly keys: ReadonlyArray<string>;
  /** What it does, as Settings → Shortcuts names it. */
  readonly action: MessageKey;
  /** The key (`KeyboardEvent.key`, lower case) pressed with Ctrl alone; absent when the key is not a single one of the table. */
  readonly ctrl?: string;
}

/**
 * Every shortcut of Timmy, in the order Settings → Shortcuts lists them. The Workspace's key handler and the list
 * both read this table, so the list cannot promise a shortcut that does not work. A new shortcut is added here once.
 */
export const shortcuts: ReadonlyArray<Shortcut> = [
  { id: 'toggleSidebar', keys: ['Ctrl', 'B'], action: 'shortcuts.toggleSidebar', ctrl: 'b' },
  { id: 'toggleSettings', keys: ['Ctrl', ','], action: 'shortcuts.toggleSettings', ctrl: ',' },
  { id: 'newTab', keys: ['Ctrl', 'T'], action: 'shortcuts.newTab', ctrl: 't' },
  { id: 'goToTab', keys: ['Ctrl', '1–9'], action: 'shortcuts.goToTab' },
  { id: 'close', keys: ['Esc'], action: 'shortcuts.close' },
];

/** The keys of a shortcut as the table lists them, for the hints the UI shows next to what it does. */
export const shortcutKeys = (id: ShortcutId): ReadonlyArray<string> => shortcuts.find((shortcut) => shortcut.id === id)?.keys ?? [];

/** The global shortcut a key press is, if any: Ctrl with no other modifier and one of the keys of the table, or 1–9. */
export const globalShortcut = (event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): GlobalShortcut | null => {
  if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return null;
  const key = event.key.toLowerCase();
  // The digit row by its physical key, so it works on layouts (AZERTY) whose digits need Shift.
  const digit = /^Digit([1-9])$/.exec(event.code);
  if (digit !== null) return { id: 'goToTab', number: Number(digit[1]) };
  const found = shortcuts.find((shortcut) => shortcut.ctrl === key);
  return found === undefined || found.id === 'close' || found.id === 'goToTab' ? null : { id: found.id };
};

/**
 * The keys of a Stack, as its header menu hints them. They act only on the focused Pane, so they are not global
 * shortcuts and Settings does not list them yet.
 */
export const stackKeys = {
  show: (position: number): ReadonlyArray<string> => ['Alt', String(position)],
  moveUp: ['Alt', 'Shift', '↑'],
  moveDown: ['Alt', 'Shift', '↓'],
  unstack: ['Alt', 'Shift', '⏎'],
} as const;

/** What a key press does to the focused Pane's Stack. */
export type StackShortcut =
  /** Alt+1–3: the View at that position, counted from 0. */
  | { readonly id: 'showView'; readonly index: number }
  /** Alt+Shift+↑/↓: the expanded View one place up (-1) or down (1). */
  | { readonly id: 'moveView'; readonly delta: -1 | 1 }
  /** Alt+Shift+Enter: the expanded View into a new Pane. */
  | { readonly id: 'unstack' };

/** The Stack shortcut a key press is, if any. Digits by their physical key, as for Ctrl+1–9. */
export const stackShortcut = (event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): StackShortcut | null => {
  if (!event.altKey || event.ctrlKey || event.metaKey) return null;
  if (!event.shiftKey) {
    const digit = /^Digit([1-3])$/.exec(event.code);
    return digit === null ? null : { id: 'showView', index: Number(digit[1]) - 1 };
  }
  if (event.key === 'ArrowUp') return { id: 'moveView', delta: -1 };
  if (event.key === 'ArrowDown') return { id: 'moveView', delta: 1 };
  if (event.key === 'Enter') return { id: 'unstack' };
  return null;
};
