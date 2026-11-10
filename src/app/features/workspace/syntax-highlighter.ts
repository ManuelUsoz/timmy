import { InjectionToken } from '@angular/core';
import { Effect } from 'effect';
import type { HljsId } from './file-language';
import type { ColourRange } from './source-text';

/** Above this many characters (about 512 KB) a file gets no colours and no symbol parse: it stays plain text. */
export const MAX_COLOURED_LENGTH = 512 * 1024;

/** What the page asks the worker; `id` pairs it with the answer. */
export interface ColourRequest {
  readonly id: number;
  readonly content: string;
  readonly hljsId: HljsId;
}

/** What the worker answers. */
export interface ColourResponse {
  readonly id: number;
  readonly ranges: ReadonlyArray<ColourRange>;
}

/** Colours source text off the main thread. A text it cannot colour has no ranges. */
export interface SyntaxHighlighter {
  readonly colours: (content: string, hljsId: HljsId) => Effect.Effect<ReadonlyArray<ColourRange>>;
}

/** One worker for the app, started with the first file that has a language. */
const makeWorkerHighlighter = (): SyntaxHighlighter => {
  let worker: Worker | undefined;
  let next = 0;
  const pending = new Map<number, (ranges: ReadonlyArray<ColourRange>) => void>();
  const start = (): Worker => {
    const started = new Worker(new URL('./syntax-colours.worker', import.meta.url), { type: 'module' });
    started.addEventListener('message', (event: MessageEvent<ColourResponse>) => {
      pending.get(event.data.id)?.(event.data.ranges);
      pending.delete(event.data.id);
    });
    // A worker that broke answers nothing more: what it owed stays plain, and the next file starts another.
    started.addEventListener('error', () => {
      started.terminate();
      worker = undefined;
      for (const resolve of pending.values()) resolve([]);
      pending.clear();
    });
    return started;
  };
  return {
    colours: (content, hljsId) =>
      Effect.callback<ReadonlyArray<ColourRange>>((resume) => {
        worker ??= start();
        next += 1;
        const id = next;
        pending.set(id, (ranges) => resume(Effect.succeed(ranges)));
        const request: ColourRequest = { id, content, hljsId };
        worker.postMessage(request);
        // A View that moved on drops its answer.
        return Effect.sync(() => pending.delete(id));
      }),
  };
};

/** Where there are no workers (the unit tests' DOM) text stays plain; a spec that looks at colours provides its own. */
export const SYNTAX_HIGHLIGHTER = new InjectionToken<SyntaxHighlighter>('SyntaxHighlighter', {
  providedIn: 'root',
  factory: () => (typeof Worker === 'undefined' ? { colours: () => Effect.succeed([]) } : makeWorkerHighlighter()),
});
