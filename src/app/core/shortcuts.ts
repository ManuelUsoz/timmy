import type { MessageKey } from './i18n-dictionaries';

/** What a shortcut does. */
export type ShortcutId = 'toggleSidebar' | 'toggleSettings' | 'close';

/** The global shortcuts, the ones the Workspace handles wherever the focus is (a Terminal included). */
export type GlobalShortcutId = Exclude<ShortcutId, 'close'>;

export interface Shortcut {
  readonly id: ShortcutId;
  /** The keys as Settings → Shortcuts shows them, in the order they are pressed. */
  readonly keys: ReadonlyArray<string>;
  /** What it does, as Settings → Shortcuts names it. */
  readonly action: MessageKey;
  /** The key (`KeyboardEvent.key`, lower case) pressed with Ctrl alone; absent when each dialog handles the key itself. */
  readonly ctrl?: string;
}

/**
 * Every shortcut of Timmy, in the order Settings → Shortcuts lists them. The Workspace's key handler and the list
 * both read this table, so the list cannot promise a shortcut that does not work. A new shortcut is added here once.
 */
export const shortcuts: ReadonlyArray<Shortcut> = [
  { id: 'toggleSidebar', keys: ['Ctrl', 'B'], action: 'shortcuts.toggleSidebar', ctrl: 'b' },
  { id: 'toggleSettings', keys: ['Ctrl', ','], action: 'shortcuts.toggleSettings', ctrl: ',' },
  { id: 'close', keys: ['Esc'], action: 'shortcuts.close' },
];

/** The global shortcut a key press is, if any: Ctrl with no other modifier and one of the keys of the table. */
export const globalShortcut = (event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): GlobalShortcutId | null => {
  if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return null;
  const key = event.key.toLowerCase();
  const found = shortcuts.find((shortcut) => shortcut.ctrl === key);
  return found === undefined || found.id === 'close' ? null : found.id;
};
