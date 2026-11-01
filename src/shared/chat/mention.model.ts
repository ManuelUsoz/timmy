import { Schema } from 'effect';

/** A file or folder of the Session's working directory that a message points at. Paths use `/` and are relative. */
export const Mention = Schema.Struct({
  path: Schema.String,
  kind: Schema.Literals(['file', 'folder']),
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
