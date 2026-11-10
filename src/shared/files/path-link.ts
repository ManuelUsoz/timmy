/** A Path link as printed, split into the path and the lines its position names. */
export interface PathLinkText {
  readonly path: string;
  readonly start: number | null;
  readonly end: number | null;
}

/** `:42`, `:42:7`, `:42-50`, `(42)` or `(42,7)` at the end of a path. */
const POSITION = /(?::(\d+)(?::\d+|-(\d+))?|\((\d+)(?:,\d+)?\))$/;

/**
 * Splits a printed path from its position (GLOSSARY: Path link). The column is dropped; a range ending before it starts is
 * one line. A name with spaces and an address (`file://`, `https://`) are not Path links: undefined.
 */
export const parsePathLink = (candidate: string): PathLinkText | undefined => {
  if (candidate === '' || /\s/.test(candidate) || /^[a-z][a-z0-9+.-]+:\/\//i.test(candidate) || /^file:/i.test(candidate)) return undefined;
  const position = POSITION.exec(candidate);
  const path = position === null ? candidate : candidate.slice(0, position.index);
  if (path === '') return undefined;
  const start = position === null ? 0 : Number(position[1] ?? position[3]);
  if (position === null || start < 1) return { path, start: null, end: null };
  const end = position[2] === undefined ? start : Number(position[2]);
  return { path, start, end: Math.max(start, end) };
};
