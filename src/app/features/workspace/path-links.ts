import { Injectable, InjectionToken, inject, signal, type Signal } from '@angular/core';
import { Effect, Exit } from 'effect';
import type { ILink, ILinkProvider } from '@xterm/xterm';
import type { PathLinkTarget } from '../../../shared/files/files.model';
import { DesktopApi } from '../../core/desktop-api';
import { EffectRuntime } from '../../core/effect-runtime';
import { LineSelections } from './line-selection';
import { bringForward } from './pane-layout';
import type { TerminalId } from './terminal-entries';
import { TabsState } from './tabs-state';
import { TerminalsState } from './terminals-state';
import { terminalView } from './views';

/** How long main's answer about a candidate is trusted, in milliseconds: a file an agent just wrote soon becomes a link. */
export const PATH_LINK_CACHE_MS = new InjectionToken<number>('PATH_LINK_CACHE_MS', { providedIn: 'root', factory: () => 5000 });

/** The longest string asked about: anything longer is not a path someone points at. */
const MAX_CANDIDATE = 1024;

/** A piece of a Terminal line that may be a Path link, by its place in the line (UTF-16 offsets, `end` exclusive). */
interface Candidate {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/**
 * Runs of what a path is made of: quotes, backticks, brackets and spaces delimit one, so a path written inside them comes
 * out bare. A `(42,7)` right after it is its position.
 */
const TOKEN = /[^\s"'`()<>[\]{}|,;]+(?:\(\d+(?:,\d+)?\))?/g;
/** Punctuation that ends a sentence, not a path. */
const TRAILING = /[.:!?]+$/;
/** An address, not a file of the Project. */
const ADDRESS = /^(?:[a-z][a-z0-9+.-]+:\/\/|file:)/i;
/** A name with an extension (`foo.ts`), with or without a position. */
const NAMED_FILE = /\.[a-z][a-z0-9_-]{0,15}(?:[:(]|$)/i;

/**
 * The pieces of `line` that may be Path links (GLOSSARY: Path link): a token with a folder separator, or a name with an
 * extension, out of the quotes, brackets or punctuation around it. Whether one is a file of the Project is main's to say.
 */
const candidatesIn = (line: string): ReadonlyArray<Candidate> =>
  [...line.matchAll(TOKEN)].flatMap((match) => {
    const text = match[0].replace(TRAILING, '');
    const looksLikePath = /[\\/]/.test(text) || NAMED_FILE.test(text);
    if (text === '' || text.length > MAX_CANDIDATE || ADDRESS.test(text) || !looksLikePath) return [];
    return [{ start: match.index, end: match.index + text.length, text }];
  });

/** The folder a shell reports with OSC 7 (`file://host/path`), with `/`; a Windows drive keeps its letter. */
export const folderFromOsc7 = (data: string): string | undefined => {
  const match = /^file:\/\/[^/]*(\/.*)$/i.exec(data.trim());
  if (match === null) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
  return /^\/[a-z]:/i.test(decoded) ? decoded.slice(1) : decoded;
};

/** What a link provider reads of the screen: xterm's `Terminal`, or as much of it as a test gives. */
export interface PathLinkBuffer {
  readonly cols: number;
  readonly buffer: {
    readonly active: {
      readonly length: number;
      getLine(y: number): { readonly isWrapped: boolean; translateToString(trimRight?: boolean): string } | undefined;
    };
  };
}

/** Where the Path links of one Terminal lead: its Project, and the folder its shell said it is in. */
export interface PathLinkContext {
  readonly terminal: TerminalId;
  readonly cwd: string;
  readonly folder: () => string | undefined;
}

/** The hovered link's hint: what it opens (path and line), where the pointer is (client px). */
export interface PathLinkHint {
  readonly label: string;
  readonly x: number;
  readonly y: number;
}

/** The link provider of one Terminal, with the hint of the link under the pointer for its screen to show. */
export interface PathLinkProvider extends ILinkProvider {
  readonly hint: Signal<PathLinkHint | undefined>;
}

/** `src/app/foo.ts:42`, `src/app/foo.ts:42-50`: what a link opens, as the hint says it. */
const labelOf = (target: PathLinkTarget): string =>
  target.start === null ? target.path : `${target.path}:${target.start === target.end ? target.start : `${target.start}-${target.end}`}`;

/**
 * Path links (GLOSSARY: Path link): finds paths in a Terminal's lines, asks main which name a file of the Project (only for
 * the line under the pointer, one candidate at a time, each answer kept a few seconds per Project and string), and opens
 * one on Ctrl (Cmd) + click as a preview File View with its lines as the Line selection.
 */
@Injectable({ providedIn: 'root' })
export class PathLinks {
  private readonly runtime = inject(EffectRuntime);
  private readonly tabs = inject(TabsState);
  private readonly terminals = inject(TerminalsState);
  private readonly selections = inject(LineSelections);
  private readonly cacheFor = inject(PATH_LINK_CACHE_MS);
  private readonly answers = new Map<string, { readonly at: number; readonly target: PathLinkTarget | null }>();
  /** The question being asked: the next waits for it, so main hears one at a time. */
  private queue: Promise<unknown> = Promise.resolve();

  /** Whether `candidate` is a file of the Project, as main says; a failure is "no". */
  resolve(cwd: string, candidate: string, folder: string | undefined): Promise<PathLinkTarget | null> {
    const key = `${cwd}\u0000${folder ?? ''}\u0000${candidate}`;
    const known = this.answers.get(key);
    if (known !== undefined && Date.now() - known.at < this.cacheFor) return Promise.resolve(known.target);
    const asked = this.queue.then(async () => {
      const exit = await this.runtime.run(
        Effect.flatMap(DesktopApi, (desktop) => desktop['Files.resolvePathLink']({ cwd, candidate, folder: folder ?? null })),
      );
      const target = Exit.isSuccess(exit) ? exit.value : null;
      this.answers.set(key, { at: Date.now(), target });
      return target;
    });
    this.queue = asked;
    return asked;
  }

  /**
   * Opens a Path link of a Terminal in its Tab (ADR 0013), as a click in the tree does: a preview File View in a Pane to the
   * right of the Terminal's, or the one already open brought forward. Its lines become the Line selection and scroll to
   * the middle.
   */
  open(terminal: TerminalId, target: PathLinkTarget): void {
    const entry = this.terminals.find(terminal);
    const tab = entry === undefined ? undefined : this.tabs.tabsOf(entry.projectId).find((each) => each.id === entry.tabId);
    if (tab === undefined) return;
    this.tabs.update(tab, (layout) => bringForward(layout, terminalView(terminal)));
    this.tabs.openFile(tab, target.path);
    if (target.start !== null) {
      // A Markdown file opened with a line must show Fuente for this View, whatever the global Renderizado/Fuente setting
      // lands in #208. Until then the File View is source-only, so the flag is carried forward for that slice.
      const source = target.path.endsWith('.md') || target.path.endsWith('.markdown');
      this.selections.reveal(tab.id, target.path, target.start, target.end ?? target.start, source);
    }
  }

  /** The link provider to register on a Terminal's xterm. */
  provider(screen: PathLinkBuffer, context: PathLinkContext): PathLinkProvider {
    const hint = signal<PathLinkHint | undefined>(undefined);
    const linkOf = (candidate: Candidate, target: PathLinkTarget, first: number): ILink => {
      const point = (offset: number) => ({ x: (offset % screen.cols) + 1, y: first + Math.floor(offset / screen.cols) });
      return {
        range: { start: point(candidate.start), end: point(candidate.end - 1) },
        text: candidate.text,
        decorations: { underline: true, pointerCursor: false },
        // A plain click or a drag selects text; only Ctrl (Cmd) + click opens.
        activate: (event) => {
          if (event.ctrlKey || event.metaKey) this.open(context.terminal, target);
        },
        hover: (event) => hint.set({ label: labelOf(target), x: event.clientX, y: event.clientY }),
        leave: () => hint.set(undefined),
      };
    };
    const provideLinks = (y: number, callback: (links: ILink[] | undefined) => void): void => {
      const line = logicalLine(screen, y);
      const onRow = candidatesIn(line.text).filter((candidate) => {
        const from = line.first + Math.floor(candidate.start / screen.cols);
        const to = line.first + Math.floor((candidate.end - 1) / screen.cols);
        return from <= y && y <= to;
      });
      void (async () => {
        const links: ILink[] = [];
        for (const candidate of onRow) {
          const target = await this.resolve(context.cwd, candidate.text, context.folder());
          if (target !== null) links.push(linkOf(candidate, target, line.first));
        }
        callback(links.length === 0 ? undefined : links);
      })();
    };
    return { hint: hint.asReadonly(), provideLinks };
  }
}

/** The whole line row `y` (1-based) is part of: the rows a long line wrapped onto joined, and the row it starts on. */
const logicalLine = (screen: PathLinkBuffer, y: number): { readonly text: string; readonly first: number } => {
  const buffer = screen.buffer.active;
  let first = y - 1;
  while (first > 0 && buffer.getLine(first)?.isWrapped === true) first--;
  let last = y - 1;
  while (last + 1 < buffer.length && buffer.getLine(last + 1)?.isWrapped === true) last++;
  let text = '';
  for (let row = first; row <= last; row++) text += buffer.getLine(row)?.translateToString(row === last) ?? '';
  return { text, first: first + 1 };
};
