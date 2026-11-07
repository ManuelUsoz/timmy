/** The open Switcher: which card is selected, and whether it stays open when Ctrl is released. */
export interface SwitcherModel {
  /** Among the cards shown now (the search's matches). */
  readonly selected: number;
  /**
   * Opened with Ctrl+Tab, releasing Ctrl confirms. Once the user moves with the arrows or clicks inside it, it stays
   * open for the search, until Enter, a click on a card, a number or Esc.
   */
  readonly sticky: boolean;
}

export type SwitcherKeyEvent = Pick<KeyboardEvent, 'type' | 'key' | 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>;

/** What a key does to the Switcher. */
export type SwitcherStep =
  /** Not the Switcher's key: it goes where it would have gone (the search field, while open). */
  | { readonly id: 'ignore' }
  /** Open, or stay open, with this. The key is the Switcher's. */
  | { readonly id: 'show'; readonly model: SwitcherModel }
  /** Go to the Tab of the card at this index, and close. */
  | { readonly id: 'confirm'; readonly index: number }
  | { readonly id: 'cancel' };

export interface SwitcherContext {
  /** How many cards are shown now. */
  readonly count: number;
  /** Whether the search field holds text: then digits and left/right are typing, not moving. */
  readonly typing: boolean;
}

const wrap = (index: number, count: number): number => (count === 0 ? 0 : (index + count) % count);

/** The press that opens the Switcher. */
export const isCtrlTab = (event: SwitcherKeyEvent): boolean => event.key === 'Tab' && event.ctrlKey && !event.altKey && !event.metaKey;

/**
 * The Switcher's keys (GLOSSARY: Switcher). Ctrl+Tab opens it on the Tab before this one (Ctrl+Shift+Tab on the oldest)
 * and moves forward (back with Shift); releasing Ctrl confirms, Esc cancels, 1–9 jumps straight to a card. Alt+Tab is
 * not used: Windows takes it.
 */
export const switcherKey = (open: SwitcherModel | undefined, event: SwitcherKeyEvent, { count, typing }: SwitcherContext): SwitcherStep => {
  if (open === undefined) {
    if (event.type !== 'keydown' || !isCtrlTab(event) || count === 0) return { id: 'ignore' };
    return { id: 'show', model: { selected: event.shiftKey ? count - 1 : wrap(1, count), sticky: false } };
  }
  const move = (delta: number, sticky = open.sticky): SwitcherStep => ({ id: 'show', model: { selected: wrap(open.selected + delta, count), sticky } });
  const confirm = (index: number): SwitcherStep => (index < count ? { id: 'confirm', index } : { id: 'show', model: open });

  if (event.type === 'keyup') {
    if (event.key !== 'Control') return { id: 'ignore' };
    return open.sticky ? { id: 'show', model: open } : confirm(open.selected);
  }
  if (event.type !== 'keydown') return { id: 'ignore' };
  if (event.key === 'Escape') return { id: 'cancel' };
  if (event.key === 'Tab' && (event.ctrlKey || open.sticky)) return move(event.shiftKey ? -1 : 1);
  if (event.key === 'Enter') return confirm(open.selected);
  if (event.key === 'ArrowDown') return move(1, true);
  if (event.key === 'ArrowUp') return move(-1, true);
  if (!typing && event.key === 'ArrowRight') return move(1, true);
  if (!typing && event.key === 'ArrowLeft') return move(-1, true);
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(event.code);
  if (digit !== null && (event.ctrlKey || !typing)) return confirm(Number(digit[1]) - 1);
  return { id: 'ignore' };
};
