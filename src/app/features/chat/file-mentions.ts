import type { Mention } from '../../../shared/chat/mention.model';

/** The last segment of a `/` path (a trailing `/` is ignored). */
export const baseName = (path: string): string => {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
};

/** The folder part of a `/` path; empty for a top-level one. */
export const dirName = (path: string): string => {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
};

/** A file of the working directory that a message can point at, with its lowercase forms precomputed for matching. */
export interface FileEntry extends Mention {
  readonly lower: string;
  readonly nameLower: string;
}

/** Loading, failure and empty stay distinct so the popup never shows a failure as "no matches". */
export type FilesState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly detail: string }
  | { readonly status: 'ready'; readonly entries: ReadonlyArray<FileEntry>; readonly truncated: boolean };

/** Most rows the popup shows. */
export const MAX_MENTION_RESULTS = 50;

/** One entry per file. */
export const entriesFromPaths = (paths: ReadonlyArray<string>): ReadonlyArray<FileEntry> =>
  paths.map((path) => {
    const lower = path.toLowerCase();
    return { path, lower, nameLower: baseName(lower) };
  });

export interface MentionContext {
  /** Index of the `@`. */
  readonly start: number;
  /** What was typed after it, without the opening quote. */
  readonly query: string;
}

/**
 * The `@query` the caret is in. The `@` must open the text or follow whitespace, so
 * `correo@dominio.com` is not a Mention. A quoted query (`@"mi car`) may contain spaces.
 */
export const mentionContext = (text: string, caret: number): MentionContext | undefined => {
  const match = /(^|\s)@("[^"]*|[^\s"]*)$/.exec(text.slice(0, caret));
  if (match === null) return undefined;
  const typed = match[2] ?? '';
  const start = caret - typed.length - 1;
  return { start, query: typed.startsWith('"') ? typed.slice(1) : typed };
};

const subsequence = (haystack: string, needle: string): boolean => {
  let at = 0;
  for (const char of haystack) {
    if (char === needle[at]) at++;
    if (at === needle.length) return true;
  }
  return needle.length === 0;
};

/** Lower is better. File-name matches (0-2) rank above matches only in the folder path (3-4). */
const rank = ({ lower, nameLower: name }: FileEntry, needle: string): number | undefined => {
  if (name.startsWith(needle)) return 0;
  if (name.includes(needle)) return 1;
  if (subsequence(name, needle)) return 2;
  if (lower.includes(needle)) return 3;
  if (subsequence(lower, needle)) return 4;
  return undefined;
};

/** Fuzzy matches, best first, at most {@link MAX_MENTION_RESULTS}. */
export const filterEntries = (entries: ReadonlyArray<FileEntry>, query: string): ReadonlyArray<FileEntry> => {
  const needle = query.toLowerCase();
  if (needle === '') return entries.slice(0, MAX_MENTION_RESULTS);
  const ranked: { entry: FileEntry; rank: number }[] = [];
  for (const entry of entries) {
    const value = rank(entry, needle);
    if (value !== undefined) ranked.push({ entry, rank: value });
  }
  ranked.sort((a, b) => a.rank - b.rank || a.entry.path.length - b.entry.path.length);
  return ranked.slice(0, MAX_MENTION_RESULTS).map(({ entry }) => entry);
};

/** Replaces the typed `@query` with `@path ` (quoted when the path has spaces) and puts the caret after it. */
export const applyMention = (text: string, caret: number, context: MentionContext, entry: Mention) => {
  const rest = text.slice(caret).replace(/^ /, '');
  const reference = /\s/.test(entry.path) ? `@"${entry.path}" ` : `@${entry.path} `;
  return { text: text.slice(0, context.start) + reference + rest, caret: context.start + reference.length };
};
