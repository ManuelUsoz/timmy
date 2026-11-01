import type { Mention } from '../../../shared/chat/mention.model';

/** A file or folder of the working directory that a message can point at. */
export type MentionEntry = Mention;

/** Loading, failure and empty stay distinct so the popup never shows a failure as "no matches". */
export type FilesState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly detail: string }
  | { readonly status: 'ready'; readonly entries: ReadonlyArray<MentionEntry>; readonly truncated: boolean };

/** Most rows the popup shows. */
export const MAX_MENTION_RESULTS = 50;

/** Every file, plus every folder that holds one. */
export const entriesFromPaths = (paths: ReadonlyArray<string>): ReadonlyArray<MentionEntry> => {
  const folders = new Set<string>();
  for (const file of paths) {
    let slash = file.indexOf('/');
    while (slash !== -1) {
      folders.add(file.slice(0, slash));
      slash = file.indexOf('/', slash + 1);
    }
  }
  return [
    ...[...folders].map((path): MentionEntry => ({ path, kind: 'folder' })),
    ...paths.map((path): MentionEntry => ({ path, kind: 'file' })),
  ];
};

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
const rank = (path: string, needle: string): number | undefined => {
  const lower = path.toLowerCase();
  const name = lower.slice(lower.lastIndexOf('/') + 1);
  if (name.startsWith(needle)) return 0;
  if (name.includes(needle)) return 1;
  if (subsequence(name, needle)) return 2;
  if (lower.includes(needle)) return 3;
  if (subsequence(lower, needle)) return 4;
  return undefined;
};

/** Fuzzy matches, best first, at most {@link MAX_MENTION_RESULTS}. */
export const filterEntries = (entries: ReadonlyArray<MentionEntry>, query: string): ReadonlyArray<MentionEntry> => {
  const needle = query.toLowerCase();
  if (needle === '') return entries.slice(0, MAX_MENTION_RESULTS);
  const ranked: { entry: MentionEntry; rank: number }[] = [];
  for (const entry of entries) {
    const value = rank(entry.path, needle);
    if (value !== undefined) ranked.push({ entry, rank: value });
  }
  ranked.sort((a, b) => a.rank - b.rank || a.entry.path.length - b.entry.path.length);
  return ranked.slice(0, MAX_MENTION_RESULTS).map(({ entry }) => entry);
};

/** Replaces the typed `@query` with `@path ` (quoted when the path has spaces) and puts the caret after it. */
export const applyMention = (text: string, caret: number, context: MentionContext, entry: MentionEntry) => {
  const rest = text.slice(caret).replace(/^ /, '');
  const reference = /\s/.test(entry.path) ? `@"${entry.path}" ` : `@${entry.path} `;
  return { text: text.slice(0, context.start) + reference + rest, caret: context.start + reference.length };
};
