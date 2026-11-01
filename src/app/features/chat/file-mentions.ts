import type { Mention } from '../../../shared/chat/mention.model';

/** The last segment of a `/` path (a trailing `/` is ignored). */
export const baseName = (path: string): string => {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
};

/** A file of the working directory that a message can point at. */
export type FileEntry = Mention;

/** Loading, failure and empty stay distinct so the popup never shows a failure as "no matches". */
export type FilesState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly detail: string }
  | { readonly status: 'ready'; readonly entries: ReadonlyArray<FileEntry>; readonly truncated: boolean };

/** Most rows the popup shows. */
export const MAX_MENTION_RESULTS = 50;

/** One entry per file. */
export const entriesFromPaths = (paths: ReadonlyArray<string>): ReadonlyArray<FileEntry> => paths.map((path) => ({ path }));

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

export interface LevelRow {
  /** Full path from the working directory; for a folder, without a trailing `/`. */
  readonly path: string;
  readonly name: string;
  readonly kind: 'file' | 'folder';
}

/** The folder the query is inside (everything before its last `/`, empty at the root) and the filter typed after it. */
export const splitQuery = (query: string): { readonly dir: string; readonly filter: string } => {
  const slash = query.lastIndexOf('/');
  return slash === -1 ? { dir: '', filter: query } : { dir: query.slice(0, slash), filter: query.slice(slash + 1) };
};

const byName = (a: LevelRow, b: LevelRow): number =>
  a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) : a.kind === 'folder' ? -1 : 1;

/** The direct children of `dir`: its subfolders and its files, folders first, each alphabetical. */
export const childrenOf = (entries: ReadonlyArray<FileEntry>, dir: string): ReadonlyArray<LevelRow> => {
  const prefix = dir === '' ? '' : `${dir}/`;
  const folders = new Map<string, LevelRow>();
  const files: LevelRow[] = [];
  for (const { path } of entries) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash === -1) files.push({ path, name: rest, kind: 'file' });
    else {
      const name = rest.slice(0, slash);
      folders.set(name, { path: prefix + name, name, kind: 'folder' });
    }
  }
  return [...folders.values(), ...files].sort(byName);
};

/** Lower is better; `undefined` drops the row. */
const rank = (name: string, needle: string): number | undefined => {
  const lower = name.toLowerCase();
  if (lower.startsWith(needle)) return 0;
  if (lower.includes(needle)) return 1;
  return subsequence(lower, needle) ? 2 : undefined;
};

/**
 * What the popup shows for a typed `@query`: the children of the folder the query is inside, narrowed by the
 * text after its last `/` (best match first, then folders first, then alphabetical), at most {@link MAX_MENTION_RESULTS}.
 */
export const levelRows = (entries: ReadonlyArray<FileEntry>, query: string): ReadonlyArray<LevelRow> => {
  const { dir, filter } = splitQuery(query);
  const children = childrenOf(entries, dir);
  const needle = filter.toLowerCase();
  if (needle === '') return children.slice(0, MAX_MENTION_RESULTS);
  const ranked: { row: LevelRow; rank: number }[] = [];
  for (const row of children) {
    const value = rank(row.name, needle);
    if (value !== undefined) ranked.push({ row, rank: value });
  }
  ranked.sort((x, y) => x.rank - y.rank);
  return ranked.slice(0, MAX_MENTION_RESULTS).map(({ row }) => row);
};

/** Replaces the typed `@query` with the folder `@dir/` (quoted when it has spaces) so the popup shows that level next. */
export const enterFolder = (text: string, caret: number, context: MentionContext, folder: LevelRow) => {
  const reference = /\s/.test(folder.path) ? `@"${folder.path}/` : `@${folder.path}/`;
  return { text: text.slice(0, context.start) + reference + text.slice(caret), caret: context.start + reference.length };
};

/** Replaces the typed `@query` with `@path ` (quoted when the path has spaces) and puts the caret after it. */
export const applyMention = (text: string, caret: number, context: MentionContext, entry: Mention) => {
  const rest = text.slice(caret).replace(/^ /, '');
  const reference = /\s/.test(entry.path) ? `@"${entry.path}" ` : `@${entry.path} `;
  return { text: text.slice(0, context.start) + reference + rest, caret: context.start + reference.length };
};
