import { globalShortcut, shortcuts } from './shortcuts';

const press = (key: string, modifiers: { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean } = { ctrlKey: true }) => ({
  key,
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
      ['close', 'Esc'],
    ]);
  });

  it('recognises Ctrl+B and Ctrl+, whatever the case', () => {
    expect(globalShortcut(press('b'))).toBe('toggleSidebar');
    expect(globalShortcut(press('B'))).toBe('toggleSidebar');
    expect(globalShortcut(press(','))).toBe('toggleSettings');
  });

  it('ignores the keys without Ctrl, with another modifier, and Esc, which each dialog handles', () => {
    expect(globalShortcut(press('b', {}))).toBeNull();
    expect(globalShortcut(press('b', { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(globalShortcut(press(',', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(globalShortcut(press(',', { ctrlKey: true, metaKey: true }))).toBeNull();
    expect(globalShortcut(press('Escape'))).toBeNull();
    expect(globalShortcut(press('t'))).toBeNull();
  });
});
