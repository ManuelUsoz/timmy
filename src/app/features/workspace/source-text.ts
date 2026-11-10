/** The nine kinds of token the reader colours, each with a `--syntax-*` token of the theme. */
export type SyntaxToken = 'keyword' | 'string' | 'number' | 'comment' | 'function' | 'type' | 'variable' | 'punctuation' | 'meta';

/** One coloured stretch of a line: `line` counts from 1 like the line numbers, `from` and `to` are offsets in that line. */
export interface ColourRange {
  readonly line: number;
  readonly from: number;
  readonly to: number;
  readonly token: SyntaxToken;
}

/** A stretch of a line drawn in one colour; `''` is plain text. */
export interface Run {
  readonly text: string;
  readonly token: SyntaxToken | '';
}

/** How many columns a tab takes at most in the reader (`tab-size` in file-view.css). */
const TAB_COLUMNS = 2;

/** How many indented lines the indent guess looks at. */
const INDENT_SAMPLE = 200;

/** The lines of a text, without their line breaks; a final line break does not start another line. */
export const linesOf = (content: string): ReadonlyArray<string> => {
  if (content === '') return [];
  const lines = content.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  return content.endsWith('\n') ? lines.slice(0, -1) : lines;
};

/** The width in columns of the longest line, which is the width the text needs since lines never wrap. */
export const columnsOf = (lines: ReadonlyArray<string>): number =>
  lines.reduce((widest, line) => {
    if (line.length <= widest / TAB_COLUMNS) return widest;
    let columns = line.length;
    for (let at = line.indexOf('\t'); at !== -1; at = line.indexOf('\t', at + 1)) columns += TAB_COLUMNS - 1;
    return Math.max(widest, columns);
  }, 0);

/** A Line selection: the first and last line, counted from 1. */
export interface LineRange {
  readonly from: number;
  readonly to: number;
}

export type Eol = 'LF' | 'CRLF' | 'Mixed';

/** The line endings of a text, counted; a text with no line break has none to tell. */
export const eolOf = (content: string): Eol | undefined => {
  let lf = 0;
  let crlf = 0;
  for (let at = content.indexOf('\n'); at !== -1; at = content.indexOf('\n', at + 1)) {
    if (at > 0 && content[at - 1] === '\r') crlf += 1;
    else lf += 1;
  }
  if (lf === 0 && crlf === 0) return undefined;
  return lf === 0 ? 'CRLF' : crlf === 0 ? 'LF' : 'Mixed';
};

export type Indent = { readonly kind: 'tabs' } | { readonly kind: 'spaces'; readonly size: number };

/**
 * A guess of what the file indents with, from its first 200 indented lines: tabs or spaces by majority, and for
 * spaces the step lines most often move by from the line before (so a line aligned to something else does not count).
 */
export const indentOf = (lines: ReadonlyArray<string>): Indent | undefined => {
  let tabs = 0;
  let spaces = 0;
  let sampled = 0;
  let before = 0;
  const steps = new Map<number, number>();
  for (const line of lines) {
    if (sampled === INDENT_SAMPLE) break;
    if (line.startsWith('\t')) {
      tabs += 1;
      sampled += 1;
      continue;
    }
    const width = line.length - line.trimStart().length;
    if (width === line.length) continue;
    if (width > 0 && line[0] === ' ') {
      spaces += 1;
      sampled += 1;
    }
    const step = Math.abs(width - before);
    if (step > 1 && step <= 8) steps.set(step, (steps.get(step) ?? 0) + 1);
    before = width;
  }
  if (tabs === 0 && spaces === 0) return undefined;
  if (tabs >= spaces) return { kind: 'tabs' };
  let size = 0;
  let most = 0;
  for (const [step, count] of steps) {
    if (count > most || (count === most && step < size)) {
      size = step;
      most = count;
    }
  }
  return { kind: 'spaces', size: size === 0 ? TAB_COLUMNS : size };
};

/**
 * Each line as the runs to draw: the whole line plain when it has no colours, otherwise cut at its ranges. The ranges
 * come ordered by line and offset and do not overlap, as `colourRanges` gives them.
 */
export const lineRuns = (lines: ReadonlyArray<string>, ranges: ReadonlyArray<ColourRange>): ReadonlyArray<ReadonlyArray<Run>> => {
  const byLine = new Map<number, Array<ColourRange>>();
  for (const range of ranges) {
    const of = byLine.get(range.line);
    if (of === undefined) byLine.set(range.line, [range]);
    else of.push(range);
  }
  return lines.map((text, index) => {
    const coloured = byLine.get(index + 1);
    if (coloured === undefined) return [{ text, token: '' }];
    const runs: Array<Run> = [];
    let at = 0;
    for (const range of coloured) {
      const from = Math.max(range.from, at);
      const to = Math.min(range.to, text.length);
      if (from >= to) continue;
      if (from > at) runs.push({ text: text.slice(at, from), token: '' });
      runs.push({ text: text.slice(from, to), token: range.token });
      at = to;
    }
    if (at < text.length || runs.length === 0) runs.push({ text: text.slice(at), token: '' });
    return runs;
  });
};
