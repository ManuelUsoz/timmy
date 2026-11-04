import { describe, expect, it } from 'vitest';
import { makeOutputTap } from './output-tap';

const BEL = '\x07';
const ESC = '\x1b';

describe('output tap', () => {
  it('reports output for any data and nothing for none', () => {
    const tap = makeOutputTap();
    expect(tap.scan('hello')).toEqual(['Output']);
    expect(tap.scan('')).toEqual([]);
  });

  it('asks for attention on a bell', () => {
    expect(makeOutputTap().scan(`done${BEL}`)).toEqual(['Output', 'Attention']);
  });

  it.each([
    ['iTerm / Windows Terminal notification', `${ESC}]9;Build finished${BEL}`],
    ['rxvt notification', `${ESC}]777;notify;Title;Body${ESC}\\`],
    ['kitty notification', `${ESC}]99;i=1;Build finished${ESC}\\`],
  ])('asks for attention on an OSC notification: %s', (_name, data) => {
    expect(makeOutputTap().scan(data)).toEqual(['Output', 'Attention']);
  });

  it.each([
    ['window title', `${ESC}]0;pwsh${BEL}`],
    ['shell integration mark', `${ESC}]633;A${BEL}`],
    ['ConEmu progress', `${ESC}]9;4;1;50${BEL}`],
    ['ConEmu current folder', `${ESC}]9;9;C:\\work${BEL}`],
  ])('does not take the BEL that ends an OSC for a bell: %s', (_name, data) => {
    expect(makeOutputTap().scan(data)).toEqual(['Output']);
  });

  it('finds a sequence split across chunks', () => {
    const tap = makeOutputTap();
    expect(tap.scan(`${ESC}]9;Build fin`)).toEqual(['Output']);
    expect(tap.scan(`ished${ESC}`)).toEqual(['Output']);
    expect(tap.scan('\\')).toEqual(['Output', 'Attention']);
  });

  it('keeps scanning after a title sequence ended by a bell', () => {
    const tap = makeOutputTap();
    expect(tap.scan(`${ESC}]0;pwsh${BEL}prompt${BEL}`)).toEqual(['Output', 'Attention']);
  });

  it('gives up on an OSC that never ends instead of growing without bound', () => {
    const tap = makeOutputTap();
    tap.scan(`${ESC}]9;`);
    expect(tap.scan('x'.repeat(10_000))).toEqual(['Output']);
    expect(tap.scan(BEL)).toEqual(['Output', 'Attention']);
  });
});
