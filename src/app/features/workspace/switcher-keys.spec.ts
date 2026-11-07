import { switcherKey, type SwitcherKeyEvent, type SwitcherModel } from './switcher-keys';

const down = (key: string, mods: Partial<SwitcherKeyEvent> = {}): SwitcherKeyEvent => ({
  type: 'keydown',
  key,
  code: /^[1-9]$/.test(key) ? `Digit${key}` : key,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});
const ctrl = (key: string, mods: Partial<SwitcherKeyEvent> = {}) => down(key, { ctrlKey: true, ...mods });
const releaseCtrl: SwitcherKeyEvent = { ...down('Control'), type: 'keyup' };

const held = (selected: number): SwitcherModel => ({ selected, sticky: false });
const sticky = (selected: number): SwitcherModel => ({ selected, sticky: true });
const five = { count: 5, typing: false };

describe('switcherKey', () => {
  describe('while closed', () => {
    it('Ctrl+Tab opens on the second card: the Tab the user was on before this one', () => {
      expect(switcherKey(undefined, ctrl('Tab'), five)).toEqual({ id: 'show', model: held(1) });
    });

    it('Ctrl+Shift+Tab opens on the last card', () => {
      expect(switcherKey(undefined, ctrl('Tab', { shiftKey: true }), five)).toEqual({ id: 'show', model: held(4) });
    });

    it('opens on the only card when there is one', () => {
      expect(switcherKey(undefined, ctrl('Tab'), { count: 1, typing: false })).toEqual({ id: 'show', model: held(0) });
    });

    it('does not open with no Tab to go to, nor for other keys', () => {
      expect(switcherKey(undefined, ctrl('Tab'), { count: 0, typing: false })).toEqual({ id: 'ignore' });
      expect(switcherKey(undefined, down('Tab'), five)).toEqual({ id: 'ignore' });
      expect(switcherKey(undefined, ctrl('Tab', { altKey: true }), five)).toEqual({ id: 'ignore' });
      expect(switcherKey(undefined, releaseCtrl, five)).toEqual({ id: 'ignore' });
    });
  });

  describe('while open', () => {
    it('Ctrl+Tab moves forward and Ctrl+Shift+Tab back, wrapping around', () => {
      expect(switcherKey(held(1), ctrl('Tab'), five)).toEqual({ id: 'show', model: held(2) });
      expect(switcherKey(held(4), ctrl('Tab'), five)).toEqual({ id: 'show', model: held(0) });
      expect(switcherKey(held(0), ctrl('Tab', { shiftKey: true }), five)).toEqual({ id: 'show', model: held(4) });
    });

    it('releasing Ctrl confirms the selected card', () => {
      expect(switcherKey(held(2), releaseCtrl, five)).toEqual({ id: 'confirm', index: 2 });
    });

    it('Esc cancels', () => {
      expect(switcherKey(held(2), down('Escape', { ctrlKey: true }), five)).toEqual({ id: 'cancel' });
    });

    it('1–9 jumps straight to that card, with Ctrl held or not', () => {
      expect(switcherKey(held(1), ctrl('3'), five)).toEqual({ id: 'confirm', index: 2 });
      expect(switcherKey(sticky(0), down('5'), five)).toEqual({ id: 'confirm', index: 4 });
      expect(switcherKey(held(0), ctrl('4', { code: 'Numpad4' }), five)).toEqual({ id: 'confirm', index: 3 });
    });

    it('a number past the last card does nothing', () => {
      expect(switcherKey(held(1), ctrl('7'), five)).toEqual({ id: 'show', model: held(1) });
    });

    it('arrows move and keep it open after Ctrl is released, until Enter confirms', () => {
      expect(switcherKey(held(1), ctrl('ArrowDown'), five)).toEqual({ id: 'show', model: sticky(2) });
      expect(switcherKey(held(1), ctrl('ArrowLeft'), five)).toEqual({ id: 'show', model: sticky(0) });
      expect(switcherKey(sticky(2), releaseCtrl, five)).toEqual({ id: 'show', model: sticky(2) });
      expect(switcherKey(sticky(2), down('Enter'), five)).toEqual({ id: 'confirm', index: 2 });
    });

    it('Tab moves without Ctrl once it stays open', () => {
      expect(switcherKey(sticky(2), down('Tab'), five)).toEqual({ id: 'show', model: sticky(3) });
      expect(switcherKey(sticky(2), down('Tab', { shiftKey: true }), five)).toEqual({ id: 'show', model: sticky(1) });
    });

    it('while the user types a search, digits and left/right go to the search field', () => {
      const typing = { count: 5, typing: true };
      expect(switcherKey(sticky(0), down('2'), typing)).toEqual({ id: 'ignore' });
      expect(switcherKey(sticky(0), down('ArrowLeft'), typing)).toEqual({ id: 'ignore' });
      expect(switcherKey(sticky(0), down('ArrowDown'), typing)).toEqual({ id: 'show', model: sticky(1) });
    });

    it('with no card left (a search that matches nothing) Enter and Ctrl release do nothing', () => {
      const none = { count: 0, typing: true };
      expect(switcherKey(sticky(0), down('Enter'), none)).toEqual({ id: 'show', model: sticky(0) });
      expect(switcherKey(sticky(0), down('ArrowDown'), none)).toEqual({ id: 'show', model: sticky(0) });
    });

    it('other keys are left to the search field', () => {
      expect(switcherKey(sticky(0), down('a'), five)).toEqual({ id: 'ignore' });
      expect(switcherKey(held(0), { ...down('Shift'), type: 'keyup' }, five)).toEqual({ id: 'ignore' });
    });
  });
});
