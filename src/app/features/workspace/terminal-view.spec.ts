import { shortPath, terminalStateKey, terminalTone } from './terminal-view';

describe('terminal presentation', () => {
  it('colours Live as success, Error as error, and Done and Idle as idle', () => {
    expect(terminalTone('Live')).toBe('success');
    expect(terminalTone('Error')).toBe('error');
    expect(terminalTone('Done')).toBe('idle');
    expect(terminalTone('Idle')).toBe('idle');
  });

  it('names each state with its own dictionary key', () => {
    expect(terminalStateKey('Live')).toBe('state.live');
    expect(terminalStateKey('Done')).toBe('state.done');
    expect(terminalStateKey('Idle')).toBe('state.idle');
    expect(terminalStateKey('Error')).toBe('state.error');
  });

  it('shortens a Windows path to its last folder', () => {
    expect(shortPath('C:\\Users\\miuso\\workspace\\nxy\\timmy')).toBe('…\\timmy');
  });

  it('shortens a POSIX path to its last folder, ignoring a trailing separator', () => {
    expect(shortPath('/home/ana/timmy/')).toBe('…/timmy');
  });

  it('leaves a path without folders as it is', () => {
    expect(shortPath('timmy')).toBe('timmy');
  });
});
