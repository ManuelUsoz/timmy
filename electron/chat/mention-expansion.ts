import { open } from 'node:fs/promises';
import path from 'node:path';
import { Effect } from 'effect';
import { Mention } from '../../src/shared/chat/mention.model';

export const MAX_FILE_BYTES = 64 * 1024;
export const MAX_TOTAL_BYTES = 256 * 1024;
const BINARY_SNIFF_BYTES = 8 * 1024;

export interface Expansion {
  /** The prompt the adapter receives: the user's text followed by the content of each Mention. */
  readonly prompt: string;
  /** Set when anything was cut, so the UI can tell the user the agent saw only part of it. */
  readonly warning?: string;
}

interface Rendered {
  readonly block: string;
  readonly bytes: number;
  readonly cut?: string;
}

const readHead = (file: string, limit: number) =>
  Effect.tryPromise(async () => {
    const handle = await open(file, 'r');
    try {
      const { size } = await handle.stat();
      const buffer = Buffer.alloc(Math.min(size, limit + 1));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return { size, head: buffer.subarray(0, bytesRead) };
    } finally {
      await handle.close();
    }
  });

const renderFile = (cwd: string, mention: Mention, budget: number) =>
  readHead(path.join(cwd, mention.path), MAX_FILE_BYTES).pipe(
    Effect.map(({ size, head }): Rendered => {
      if (head.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
        const block = `<file path="${mention.path}" size="${size}">Binary file (${size} bytes); content not included.</file>`;
        return { block, bytes: block.length };
      }
      const allowed = Math.max(0, Math.min(MAX_FILE_BYTES, budget));
      const kept = head.subarray(0, Math.min(allowed, head.length));
      const truncated = size > kept.length;
      const note = truncated ? `\n[Truncated: showing ${kept.length} of ${size} bytes.]` : '';
      const block = `<file path="${mention.path}">\n${kept.toString('utf8')}${note}\n</file>`;
      return truncated
        ? { block, bytes: kept.length, cut: `${mention.path} was truncated` }
        : { block, bytes: kept.length };
    }),
    Effect.orElseSucceed((): Rendered => {
      const block = `<file path="${mention.path}">Could not be read; content not included.</file>`;
      return { block, bytes: block.length };
    }),
  );

/**
 * For adapters that declare `mentions: 'none'`: appends the content of each Mention to the prompt, since the
 * provider cannot read `@path` itself. Files up to 64 KB go whole, binaries as name and size, and the whole
 * message is capped at 256 KB. The user's own text is never changed here.
 */
export const expandMentions = Effect.fn('Mentions.expand')(function* (
  cwd: string,
  text: string,
  mentions: ReadonlyArray<Mention>,
) {
  if (mentions.length === 0) return { prompt: text } satisfies Expansion;
  const blocks: string[] = [];
  const cuts: string[] = [];
  let used = 0;
  for (const mention of mentions) {
    const remaining = MAX_TOTAL_BYTES - used;
    if (remaining <= 0) {
      cuts.push(`${mention.path} was left out`);
      blocks.push(`<file path="${mention.path}">Left out: message size limit reached.</file>`);
      continue;
    }
    const rendered = yield* renderFile(cwd, mention, remaining);
    used += rendered.bytes;
    blocks.push(rendered.block);
    if (rendered.cut !== undefined) cuts.push(rendered.cut);
  }
  const prompt = `${text}\n\n<mentions>\n${blocks.join('\n')}\n</mentions>`;
  return cuts.length === 0
    ? ({ prompt } satisfies Expansion)
    : ({ prompt, warning: `Some mentioned content was cut: ${cuts.join('; ')}.` } satisfies Expansion);
});
