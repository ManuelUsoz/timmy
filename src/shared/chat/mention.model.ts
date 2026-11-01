import { Schema } from 'effect';

/** A file of the Session's working directory that a message points at. Paths use `/` and are relative. */
export const Mention = Schema.Struct({
  path: Schema.String,
}).annotate({ identifier: 'Mention' });
export type Mention = typeof Mention.Type;

/** What the parser found in a text: the Mentions that resolved, once each, and the paths that did not. */
export interface ParsedMentions {
  readonly mentions: ReadonlyArray<Mention>;
  readonly invalid: ReadonlyArray<string>;
}

const TRAILING_PUNCTUATION = /[,.;:)?!]+$/;

/** `@` opens a Mention only at the start of the text or after whitespace, so `correo@dominio.com` is plain text. */
const MENTION_PATTERN = /(?<=^|\s)@(?:"([^"]*)"|([^\s"]+))/g;

/**
 * Finds the `@path` and `@"path with spaces"` Mentions of a text. `resolve` says whether a path is a valid
 * Mention. An unquoted Mention ends at the first whitespace; when that does not resolve, trailing
 * `, . ; : ) ? !` are stripped and it is tried again. The text itself is never changed.
 */
export const parseMentions = (
  text: string,
  resolve: (path: string) => Mention | undefined,
): ParsedMentions => {
  const found = new Map<string, Mention>();
  const invalid: string[] = [];
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const quoted = match[1];
    const raw = quoted ?? match[2] ?? '';
    const candidates = quoted !== undefined ? [raw] : [raw, raw.replace(TRAILING_PUNCTUATION, '')];
    const resolved = candidates.reduce<Mention | undefined>(
      (hit, candidate) => hit ?? (candidate === '' ? undefined : resolve(candidate)),
      undefined,
    );
    if (resolved !== undefined) {
      found.set(resolved.path, resolved);
      continue;
    }
    const reported = candidates[candidates.length - 1] ?? raw;
    const shown = reported === '' ? raw : reported;
    if (shown !== '' && !invalid.includes(shown)) invalid.push(shown);
  }
  return { mentions: [...found.values()], invalid };
};

/** A piece of a message text: plain text, or a Mention written as `@path` / `@"path"`. */
export type MentionSegment =
  | { readonly kind: 'Text'; readonly text: string }
  | { readonly kind: 'Mention'; readonly path: string; readonly raw: string };

/**
 * Splits a sent message into text and Mention segments for display, without touching the file system. The same
 * `@` rule as the parser applies, so `correo@dominio.com` stays text; trailing punctuation after an unquoted
 * Mention stays in the text.
 */
export const splitMentionText = (text: string): ReadonlyArray<MentionSegment> => {
  const segments: MentionSegment[] = [];
  let cursor = 0;
  const pushText = (end: number): void => {
    if (end > cursor) segments.push({ kind: 'Text', text: text.slice(cursor, end) });
  };
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const quoted = match[1];
    const unquoted = match[2] ?? '';
    const path = quoted ?? unquoted.replace(TRAILING_PUNCTUATION, '');
    if (path === '') continue;
    const start = match.index;
    const end = quoted !== undefined ? start + match[0].length : start + 1 + path.length;
    pushText(start);
    segments.push({ kind: 'Mention', path, raw: text.slice(start, end) });
    cursor = end;
  }
  pushText(text.length);
  return segments;
};
