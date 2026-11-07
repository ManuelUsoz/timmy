import { previewLines } from './terminal-tail';

describe('previewLines', () => {
  it('is the last four lines of output', () => {
    expect(previewLines(['a', 'b', 'c', 'd', 'e', 'f'])).toEqual(['c', 'd', 'e', 'f']);
  });

  it('takes as many lines as asked for', () => {
    expect(previewLines(['a', 'b', 'c'], 2)).toEqual(['b', 'c']);
  });

  it('skips the empty rows below the prompt, which say nothing', () => {
    expect(previewLines(['a', 'b', 'PS C:\\demo> ', '', '   ', ''])).toEqual(['a', 'b', 'PS C:\\demo>']);
  });

  it('keeps blank lines between output lines', () => {
    expect(previewLines(['a', '', 'b'])).toEqual(['a', '', 'b']);
  });

  it('trims the padding at the end of each line', () => {
    expect(previewLines(['  build ok   ', 'done\t'])).toEqual(['  build ok', 'done']);
  });

  it('is nothing for a Terminal that printed nothing', () => {
    expect(previewLines([])).toEqual([]);
    expect(previewLines(['', '  '])).toEqual([]);
  });
});
