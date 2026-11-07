import { globalShortcut, shortcuts } from './shortcuts';

/** A key press on a US layout; `code` is the physical key. */
const press = (key: string, modifiers: { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean; code?: string } = { ctrlKey: true }) => ({
  key,
  code: /^[0-9]$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...modifiers,
});

describe('shortcuts', () => {
  it('lists every shortcut once, with the keys Settings shows', () => {
    expect(shortcuts.map((shortcut) => [shortcut.id, shortcut.keys.join('+')])).toEqual([
      ['toggleSidebar', 'Ctrl+B'],
      ['toggleSettings', 'Ctrl+,'],
      ['newTab', 'Ctrl+T'],
      ['goToTab', 'Ctrl+1–9'],
      ['close', 'Esc'],
    ]);
  });

  it('recognises Ctrl+T as New Tab', () => {
    expect(globalShortcut(press('t'))).toEqual({ id: 'newTab' });
    expect(globalShortcut(press('T'))).toEqual({ id: 'newTab' });
  });

  it('recognises Ctrl+1 to Ctrl+9 as going to the Tab with that number, and nothing for Ctrl+0', () => {
    expect(globalShortcut(press('1'))).toEqual({ id: 'goToTab', number: 1 });
    expect(globalShortcut(press('9'))).toEqual({ id: 'goToTab', number: 9 });
    expect(globalShortcut(press('0'))).toBeNull();
    // AZERTY: the 1 key without Shift is "&", and it is still Tab 1.
    expect(globalShortcut(press('&', { ctrlKey: true, code: 'Digit1' }))).toEqual({ id: 'goToTab', number: 1 });
    expect(globalShortcut(press('3', {}))).toBeNull();
    expect(globalShortcut(press('3', { ctrlKey: true, shiftKey: true }))).toBeNull();
  });

  it('recognises Ctrl+B and Ctrl+, whatever the case', () => {
    expect(globalShortcut(press('b'))).toEqual({ id: 'toggleSidebar' });
    expect(globalShortcut(press('B'))).toEqual({ id: 'toggleSidebar' });
    expect(globalShortcut(press(','))).toEqual({ id: 'toggleSettings' });
  });

  it('ignores the keys without Ctrl, with another modifier, and Esc, which each dialog handles', () => {
    expect(globalShortcut(press('b', {}))).toBeNull();
    expect(globalShortcut(press('b', { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(globalShortcut(press(',', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(globalShortcut(press(',', { ctrlKey: true, metaKey: true }))).toBeNull();
    expect(globalShortcut(press('Escape'))).toBeNull();
    expect(globalShortcut(press('x'))).toBeNull();
  });
});
