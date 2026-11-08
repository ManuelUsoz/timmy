import type { MessageKey } from './i18n-dictionaries';

/** A shortcut pressed with Ctrl alone, which the Workspace handles wherever the focus is. */
type CtrlShortcutId = 'toggleSidebar' | 'toggleSettings' | 'newTab' | 'files';

/** What a shortcut does. */
export type ShortcutId =
  | CtrlShortcutId
  | 'goToTab'
  | 'switcher'
  | 'close'
  | 'splitRight'
  | 'splitDown'
  | 'addToStack'
  | 'showView'
  | 'moveViewUp'
  | 'moveViewDown'
  | 'unstack';

/** The groups Settings → Shortcuts lists them under: the whole Workspace, or the focused Pane and its Stack. */
export type ShortcutGroup = 'workspace' | 'pane';

/** A global shortcut as pressed: the Workspace handles these wherever the focus is (a Terminal included). */
export type GlobalShortcut =
  | { readonly id: CtrlShortcutId }
  /** Ctrl+1–9: the Tab with that number, counted from 1. */
  | { readonly id: 'goToTab'; readonly number: number };

export interface Shortcut {
  readonly id: ShortcutId;
  readonly group: ShortcutGroup;
  /** The keys as Settings → Shortcuts shows them, in the order they are pressed. */
  readonly keys: ReadonlyArray<string>;
  /** What it does, as Settings → Shortcuts names it. */
  readonly action: MessageKey;
  /** The key (`KeyboardEvent.key`, lower case) pressed with Ctrl alone; absent when the key is not a single one of the table. */
  readonly ctrl?: string;
}

/**
 * The keys of a Pane and its Stack, as its header and menu hint them. They act only on the focused Pane, which handles
 * them (see `stackShortcut`).
 */
export const stackKeys = {
  show: (position: number): ReadonlyArray<string> => ['Alt', String(position)],
  moveUp: ['Alt', 'Shift', '↑'],
  moveDown: ['Alt', 'Shift', '↓'],
  unstack: ['Alt', 'Shift', '⏎'],
  splitRight: ['Alt', 'Shift', 'R'],
  splitDown: ['Alt', 'Shift', 'D'],
  addToStack: ['Alt', 'Shift', 'S'],
} as const;

/**
 * Every shortcut of Timmy, in the order Settings → Shortcuts lists them. The key handlers and the list both read this
 * table, so the list cannot promise a shortcut that does not work. A new shortcut is added here once.
 */
export const shortcuts: ReadonlyArray<Shortcut> = [
  { id: 'toggleSidebar', group: 'workspace', keys: ['Ctrl', 'B'], action: 'shortcuts.toggleSidebar', ctrl: 'b' },
  { id: 'toggleSettings', group: 'workspace', keys: ['Ctrl', ','], action: 'shortcuts.toggleSettings', ctrl: ',' },
  { id: 'newTab', group: 'workspace', keys: ['Ctrl', 'T'], action: 'shortcuts.newTab', ctrl: 't' },
  { id: 'files', group: 'workspace', keys: ['Ctrl', 'P'], action: 'shortcuts.files', ctrl: 'p' },
  { id: 'goToTab', group: 'workspace', keys: ['Ctrl', '1–9'], action: 'shortcuts.goToTab' },
  { id: 'switcher', group: 'workspace', keys: ['Ctrl', 'Tab'], action: 'shortcuts.switcher' },
  { id: 'close', group: 'workspace', keys: ['Esc'], action: 'shortcuts.close' },
  { id: 'splitRight', group: 'pane', keys: stackKeys.splitRight, action: 'shortcuts.splitRight' },
  { id: 'splitDown', group: 'pane', keys: stackKeys.splitDown, action: 'shortcuts.splitDown' },
  { id: 'addToStack', group: 'pane', keys: stackKeys.addToStack, action: 'shortcuts.addToStack' },
  { id: 'showView', group: 'pane', keys: ['Alt', '1–3'], action: 'shortcuts.showView' },
  { id: 'moveViewUp', group: 'pane', keys: stackKeys.moveUp, action: 'shortcuts.moveViewUp' },
  { id: 'moveViewDown', group: 'pane', keys: stackKeys.moveDown, action: 'shortcuts.moveViewDown' },
  { id: 'unstack', group: 'pane', keys: stackKeys.unstack, action: 'shortcuts.unstack' },
];

/** The keys of a shortcut as the table lists them, for the hints the UI shows next to what it does. */
export const shortcutKeys = (id: ShortcutId): ReadonlyArray<string> => shortcuts.find((shortcut) => shortcut.id === id)?.keys ?? [];

const isCtrlShortcut = (id: ShortcutId): id is CtrlShortcutId => id === 'toggleSidebar' || id === 'toggleSettings' || id === 'newTab' || id === 'files';

/** The global shortcut a key press is, if any: Ctrl with no other modifier and one of the keys of the table, or 1–9. */
export const globalShortcut = (event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): GlobalShortcut | null => {
  if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return null;
  const key = event.key.toLowerCase();
  // The digit row by its physical key, so it works on layouts (AZERTY) whose digits need Shift.
  const digit = /^Digit([1-9])$/.exec(event.code);
  if (digit !== null) return { id: 'goToTab', number: Number(digit[1]) };
  const found = shortcuts.find((shortcut) => shortcut.ctrl === key);
  return found === undefined || !isCtrlShortcut(found.id) ? null : { id: found.id };
};

/** What a key press does to the focused Pane and its Stack. */
export type StackShortcut =
  /** Alt+1–3: the View at that position, counted from 0. */
  | { readonly id: 'showView'; readonly index: number }
  /** Alt+Shift+↑/↓: the expanded View one place up (-1) or down (1). */
  | { readonly id: 'moveView'; readonly delta: -1 | 1 }
  /** Alt+Shift+Enter: the expanded View into a new Pane. */
  | { readonly id: 'unstack' }
  /** Alt+Shift+R / D / S: a new Terminal to the right, below, or on the Stack (the picker opens when it offers Providers). */
  | { readonly id: 'splitRight' }
  | { readonly id: 'splitDown' }
  | { readonly id: 'addToStack' };

/** The letters with Alt+Shift, by their physical key so the layout does not change them. */
const LETTERS: Readonly<Record<string, StackShortcut>> = {
  KeyR: { id: 'splitRight' },
  KeyD: { id: 'splitDown' },
  KeyS: { id: 'addToStack' },
};

/** The Pane or Stack shortcut a key press is, if any. Digits and letters by their physical key, as for Ctrl+1–9. */
export const stackShortcut = (event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): StackShortcut | null => {
  if (!event.altKey || event.ctrlKey || event.metaKey) return null;
  if (!event.shiftKey) {
    const digit = /^Digit([1-3])$/.exec(event.code);
    return digit === null ? null : { id: 'showView', index: Number(digit[1]) - 1 };
  }
  if (event.key === 'ArrowUp') return { id: 'moveView', delta: -1 };
  if (event.key === 'ArrowDown') return { id: 'moveView', delta: 1 };
  if (event.key === 'Enter') return { id: 'unstack' };
  return LETTERS[event.code] ?? null;
};
