import { globalShortcut, shortcuts, stackShortcut } from './shortcuts';

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
    expect(shortcuts.map((shortcut) => [shortcut.group, shortcut.id, shortcut.keys.join('+')])).toEqual([
      ['workspace', 'toggleSidebar', 'Ctrl+B'],
      ['workspace', 'toggleSettings', 'Ctrl+,'],
      ['workspace', 'newTab', 'Ctrl+T'],
      ['workspace', 'goToTab', 'Ctrl+1–9'],
      ['workspace', 'switcher', 'Ctrl+Tab'],
      ['workspace', 'close', 'Esc'],
      ['pane', 'splitRight', 'Alt+Shift+R'],
      ['pane', 'splitDown', 'Alt+Shift+D'],
      ['pane', 'addToStack', 'Alt+Shift+S'],
      ['pane', 'showView', 'Alt+1–3'],
      ['pane', 'moveViewUp', 'Alt+Shift+↑'],
      ['pane', 'moveViewDown', 'Alt+Shift+↓'],
      ['pane', 'unstack', 'Alt+Shift+⏎'],
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

describe('stackShortcut', () => {
  const alt = { altKey: true };
  const altShift = { altKey: true, shiftKey: true };

  it('recognises Alt+1 to Alt+3 as showing that View, by the physical key', () => {
    expect(stackShortcut(press('1', alt))).toEqual({ id: 'showView', index: 0 });
    expect(stackShortcut(press('3', alt))).toEqual({ id: 'showView', index: 2 });
    expect(stackShortcut(press('&', { altKey: true, code: 'Digit2' }))).toEqual({ id: 'showView', index: 1 });
    expect(stackShortcut(press('4', alt))).toBeNull();
  });

  it('recognises Alt+Shift+↑/↓ as moving the View and Alt+Shift+Enter as unstacking it', () => {
    expect(stackShortcut(press('ArrowUp', altShift))).toEqual({ id: 'moveView', delta: -1 });
    expect(stackShortcut(press('ArrowDown', altShift))).toEqual({ id: 'moveView', delta: 1 });
    expect(stackShortcut(press('Enter', altShift))).toEqual({ id: 'unstack' });
  });

  it('recognises Alt+Shift+R, D and S as split right, split down and add to stack, by the physical key', () => {
    expect(stackShortcut(press('R', altShift))).toEqual({ id: 'splitRight' });
    expect(stackShortcut(press('D', altShift))).toEqual({ id: 'splitDown' });
    expect(stackShortcut(press('S', altShift))).toEqual({ id: 'addToStack' });
    expect(stackShortcut(press('ß', { altKey: true, shiftKey: true, code: 'KeyS' }))).toEqual({ id: 'addToStack' });
    expect(stackShortcut(press('r', alt))).toBeNull();
    expect(stackShortcut(press('X', altShift))).toBeNull();
  });

  it('ignores the keys with Ctrl, without Alt, or arrows without Shift', () => {
    expect(stackShortcut(press('1', { altKey: true, ctrlKey: true }))).toBeNull();
    expect(stackShortcut(press('R', { altKey: true, shiftKey: true, ctrlKey: true }))).toBeNull();
    expect(stackShortcut(press('1', {}))).toBeNull();
    expect(stackShortcut(press('ArrowUp', alt))).toBeNull();
    expect(stackShortcut(press('Enter', alt))).toBeNull();
  });
});
