import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { Effect } from 'effect';
import { ChatError } from '../../src/shared/chat/chat-error.model';
import { Mention, parseMentions } from '../../src/shared/chat/mention.model';
import { FilesError } from '../../src/shared/files/files-error.model';
import { ProjectFiles } from '../files/project-files';

/** A relative path with no `..` or `.` segment, no drive and no backslash: the only shape a Mention may have. */
const isPlainRelative = (candidate: string): boolean =>
  !candidate.startsWith('/') &&
  !candidate.includes(String.fromCharCode(92)) &&
  !/^[A-Za-z]:/.test(candidate) &&
  candidate.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');

const folderPaths = (files: ReadonlyArray<string>): ReadonlySet<string> => {
  const folders = new Set<string>();
  for (const file of files) {
    for (let slash = file.indexOf('/'); slash !== -1; slash = file.indexOf('/', slash + 1)) {
      folders.add(file.slice(0, slash));
    }
  }
  return folders;
};

/** Whether `target` still exists and, symlinks followed, stays inside `root`. */
const staysInside = (root: string, target: string): Effect.Effect<boolean> =>
  Effect.tryPromise(async () => {
    const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)]);
    const relative = path.relative(realRoot, realTarget);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  }).pipe(Effect.orElseSucceed(() => false));

const mayMention = /(?<=^|\s)@\S/;

/**
 * The Mentions of `text`, checked against the git-listed set of `cwd` (tracked plus untracked and not ignored),
 * so ignored files such as `.env` cannot be mentioned even when typed by hand. Fails with `InvalidMention`,
 * listing every offending path, before any Turn can start. Without a candidate `@` it never calls git.
 */
export const resolveMentions = Effect.fn('Mentions.resolve')(function* (cwd: string, text: string) {
  if (!mayMention.test(text)) return [] as ReadonlyArray<Mention>;
  const projectFiles = yield* ProjectFiles;
  const listing = yield* projectFiles.list(cwd).pipe(
    Effect.catchTag('FilesError', (error: FilesError) =>
      Effect.fail(new ChatError({ reason: 'InvalidMention', detail: `Cannot check mentions: ${error.detail}` })),
    ),
  );
  const files = new Set(listing.paths);
  const folders = folderPaths(listing.paths);
  const candidates = parseMentions(text, (candidate) => {
    const normalized = candidate.endsWith('/') ? candidate.slice(0, -1) : candidate;
    if (!isPlainRelative(normalized)) return undefined;
    if (files.has(normalized)) return { path: normalized, kind: 'file' };
    return folders.has(normalized) ? { path: normalized, kind: 'folder' } : undefined;
  });
  const inside = yield* Effect.forEach(candidates.mentions, (mention) =>
    staysInside(cwd, path.join(cwd, mention.path)).pipe(Effect.map((ok) => (ok ? undefined : mention.path))),
  );
  const offending = [...candidates.invalid, ...inside.filter((p): p is string => p !== undefined)];
  if (offending.length > 0) {
    return yield* new ChatError({
      reason: 'InvalidMention',
      detail: `Invalid mention${offending.length === 1 ? '' : 's'}: ${offending.join(', ')}`,
    });
  }
  return candidates.mentions;
});
