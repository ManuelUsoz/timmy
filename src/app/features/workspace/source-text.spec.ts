import { columnsOf, eolOf, indentOf, lineRuns, linesOf } from './source-text';

describe('The lines of a source file', () => {
  it('are split at each line break, which is not part of the line', () => {
    expect(linesOf('one\ntwo\r\nthree')).toEqual(['one', 'two', 'three']);
  });

  it('do not gain a last empty line from a final line break', () => {
    expect(linesOf('one\ntwo\n')).toEqual(['one', 'two']);
    expect(linesOf('one\n\n')).toEqual(['one', '']);
  });

  it('are none for an empty file', () => {
    expect(linesOf('')).toEqual([]);
  });

  it('are as wide as the longest, a tab counting as the two columns it can take', () => {
    expect(columnsOf(['ab', 'abcde', ''])).toBe(5);
    expect(columnsOf(['\t\tab'])).toBe(6);
  });
});

describe('The line endings of a source file', () => {
  it('are LF when every line break is a line feed', () => {
    expect(eolOf('a\nb\nc\n')).toBe('LF');
  });

  it('are CRLF when every line break is a carriage return and a line feed', () => {
    expect(eolOf('a\r\nb\r\n')).toBe('CRLF');
  });

  it('are Mixed when the file has both', () => {
    expect(eolOf('a\r\nb\nc\r\n')).toBe('Mixed');
  });

  it('are unknown for a file of one line', () => {
    expect(eolOf('just this')).toBeUndefined();
  });
});

describe('The indent guess of a source file', () => {
  it('is tabs when the indented lines start with a tab', () => {
    expect(indentOf(['class A {', '\tvoid run() {', '\t\treturn;', '\t}', '}'])).toEqual({ kind: 'tabs' });
  });

  it('is spaces with the step the indented lines move by', () => {
    expect(indentOf(['a:', '  b:', '    c: 1', '  d: 2'])).toEqual({ kind: 'spaces', size: 2 });
    expect(indentOf(['def f():', '    if x:', '        return 1', '    return 2'])).toEqual({ kind: 'spaces', size: 4 });
  });

  it('is not thrown off by a line aligned to something else', () => {
    const lines = ['function f(a,', '           b) {', '  one();', '  if (a) {', '    two();', '  }', '}'];
    expect(indentOf(lines)).toEqual({ kind: 'spaces', size: 2 });
  });

  it('goes with the majority when tabs and spaces are mixed', () => {
    expect(indentOf(['\ta', '\tb', '  c'])).toEqual({ kind: 'tabs' });
    expect(indentOf(['  a', '  b', '\tc'])).toEqual({ kind: 'spaces', size: 2 });
  });

  it('is unknown when no line is indented', () => {
    expect(indentOf(['a', 'b', ''])).toBeUndefined();
  });

  it('looks at the first 200 indented lines only', () => {
    const spaces = Array.from({ length: 200 }, () => '  x');
    const tabs = Array.from({ length: 500 }, () => '\tx');
    expect(indentOf(['top', ...spaces, ...tabs])).toEqual({ kind: 'spaces', size: 2 });
  });
});

describe('The runs of a line', () => {
  /** Each line as its runs, a coloured one written `token(text)`. */
  const runs = (lines: ReadonlyArray<string>, ranges: Parameters<typeof lineRuns>[1]) =>
    lineRuns(lines, ranges).map((line) => line.map((run) => (run.token === '' ? run.text : `${run.token}(${run.text})`)).join('|'));

  it('are the whole line, plain, while it has no colours', () => {
    expect(runs(['const a = 1;', ''], [])).toEqual(['const a = 1;', '']);
  });

  it('cut the line at its colour ranges, with the text between them plain', () => {
    const ranges = [
      { line: 1, from: 0, to: 5, token: 'keyword' as const },
      { line: 1, from: 10, to: 11, token: 'number' as const },
      { line: 2, from: 0, to: 4, token: 'comment' as const },
    ];
    expect(runs(['const a = 1;', '// x', 'b'], ranges)).toEqual(['keyword(const)| a = |number(1)|;', 'comment(// x)', 'b']);
  });

  it('ignore a range that falls outside its line', () => {
    const ranges = [
      { line: 1, from: 2, to: 40, token: 'string' as const },
      { line: 9, from: 0, to: 1, token: 'string' as const },
    ];
    expect(runs(['abcd'], ranges)).toEqual(['ab|string(cd)']);
  });
});
