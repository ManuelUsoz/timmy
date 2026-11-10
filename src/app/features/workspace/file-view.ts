import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, effect, inject, input, signal, untracked, Injector } from '@angular/core';
import { Cause, Effect, Exit } from 'effect';
import { DesktopApi } from '../../core/desktop-api';
import { EffectRuntime } from '../../core/effect-runtime';
import { I18n } from '../../core/i18n';
import { LineSelections, clampLines, clickLine, isOnlyLine, lineRange, linesOf, pathWithLines, rangeFrom, selectedText } from './line-selection';
import type { TabId } from './tabs';
import { TabsState } from './tabs-state';
import { fileOf } from './views';

/** What reading the file of a File View gave. `gone` is a file deleted since it was listed or opened. */
export type FileState =
  | { readonly status: 'loading' }
  | { readonly status: 'text'; readonly content: string }
  | { readonly status: 'binary' }
  | { readonly status: 'tooLarge'; readonly size: number }
  | { readonly status: 'gone' }
  | { readonly status: 'unreadable' }
  | { readonly status: 'failed'; readonly detail: string };

/** Reads a file of the Project into what a File View shows; what main says of a file it cannot show is one of the states. */
const readFile = (cwd: string, file: string) =>
  Effect.flatMap(DesktopApi, (desktop) => desktop['Files.read']({ cwd, file })).pipe(
    Effect.map((content): FileState => {
      switch (content.kind) {
        case 'text':
          return { status: 'text', content: content.content };
        case 'binary':
          return { status: 'binary' };
        case 'tooLarge':
          return { status: 'tooLarge', size: content.size };
      }
    }),
    Effect.catchTag('FilesError', (error) =>
      Effect.succeed<FileState>(
        error.reason === 'FileNotFound' ? { status: 'gone' } : error.reason === 'Unreadable' ? { status: 'unreadable' } : { status: 'failed', detail: error.detail },
      ),
    ),
  );

/** Asks main to open a file of the Project outside Timmy, with the app the system has for it. */
const openOutside = (cwd: string, file: string) => Effect.flatMap(DesktopApi, (desktop) => desktop['Files.openExternal']({ cwd, file }));

/** `2.5 MB`: the size of a file too large to preview. */
export const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/** The height of a line of the text, in px (`.code` in the styles). Lines never wrap, so a place tells a line. */
const LINE_HEIGHT = 18;
/** The height of the Line selection's popover and its gap to the lines, in px (`.line-actions` in the styles). */
const POPOVER_HEIGHT = 32;
const POPOVER_GAP = 4;

/** Where the marks of a Line selection go, in px from the top of the first line. */
interface LineMarks {
  readonly top: number;
  readonly height: number;
  readonly popoverTop: number;
  readonly above: boolean;
  readonly range: string;
}

/**
 * The body of a File View (GLOSSARY: File View, ADR 0013): one file of the Project, read-only, as plain text with its
 * line numbers, or the state that says why it is not shown (binary, too large, gone, unreadable). It reads the file when
 * it opens and when its path changes (a preview replaced). A file picked in the tree gives it the keyboard
 * (`TabsState.focusRequest`), so the user can scroll at once. Its header is the Pane's (`PaneStack`), whose file actions
 * (Copiar, Copiar ruta, open outside) call this View.
 *
 * The Line selection (GLOSSARY) is marked from the line numbers and kept in `LineSelections`, not in the lines: the tint
 * and the popover are one layer over the text, placed by line height, so how the lines are drawn can change freely.
 */
@Component({
  selector: 'app-file-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './file-view.html',
  styleUrl: './file-view.css',
  host: { '(document:mouseup)': 'endDrag()' },
})
export class FileView {
  protected readonly i18n = inject(I18n);
  private readonly runtime = inject(EffectRuntime);
  private readonly tabs = inject(TabsState);
  private readonly selections = inject(LineSelections);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** The Project's folder, which the path is relative to. */
  readonly cwd = input.required<string>();
  readonly path = input.required<string>();
  /** The Tab it is in, to tell a request for the keyboard meant for it. */
  readonly tabId = input.required<TabId>();

  protected readonly file = signal<FileState>({ status: 'loading' });
  protected readonly name = computed(() => this.path().split('/').at(-1) ?? this.path());

  /** How many lines the text has; 0 for anything that is not text. */
  private readonly lineCount = computed(() => {
    const file = this.file();
    return file.status === 'text' ? linesOf(file.content).length : 0;
  });

  /** One number per line of the text; a final newline does not start another line. */
  protected readonly gutter = computed(() => Array.from({ length: this.lineCount() }, (_, index) => index + 1).join('\n'));

  /** The Line selection as this file can hold it; none while the file is not shown as text. */
  readonly selection = computed(() => clampLines(this.selections.of(this.tabId(), this.path()), this.lineCount()));

  /** Whether there is text to copy: the header's Copiar is off for a file that is not shown. */
  readonly hasText = computed(() => this.lineCount() > 0);

  /** What the user sees of the text: how far it is scrolled and how tall the Pane is, to place the popover. */
  private readonly viewport = signal({ top: 0, height: 0 });

  protected readonly marks = computed((): LineMarks | undefined => {
    const selection = this.selection();
    if (selection === undefined) return undefined;
    const { top, height } = this.viewport();
    const below = selection.end * LINE_HEIGHT + POPOVER_GAP;
    const over = (selection.start - 1) * LINE_HEIGHT - POPOVER_GAP - POPOVER_HEIGHT;
    // Near the Pane's bottom there is no room under the lines, unless above them it would be out of sight; a height not
    // known yet (0) never flips it.
    const above = height > 0 && below + POPOVER_HEIGHT > top + height && over >= top;
    return {
      top: (selection.start - 1) * LINE_HEIGHT,
      height: (selection.end - selection.start + 1) * LINE_HEIGHT,
      popoverTop: above ? over : below,
      above,
      range: lineRange(selection),
    };
  });

  /** The line a drag down the numbers started on; `clears` while a click on the only selected line may still clear it. */
  private drag: { readonly anchor: number; readonly clears: boolean } | undefined;

  constructor() {
    effect(() => {
      const cwd = this.cwd();
      const path = this.path();
      untracked(() => void this.read(cwd, path));
    });
    effect(() => {
      const request = this.tabs.focusRequest();
      if (request === undefined || request.tab !== this.tabId() || fileOf(request.view) !== this.path()) return;
      untracked(() => {
        this.tabs.focusRequest.set(undefined);
        afterNextRender(() => this.scroller()?.focus(), { injector: this.injector });
      });
    });
    // A selection set from elsewhere is placed against what is on screen now.
    effect(() => {
      if (this.selection() !== undefined) untracked(() => this.measure());
    });
  }

  protected size(bytes: number): string {
    return formatSize(bytes);
  }

  private scroller(): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>('.scroll');
  }

  private async read(cwd: string, path: string): Promise<void> {
    this.file.set({ status: 'loading' });
    const exit = await this.runtime.run(readFile(cwd, path));
    // Another file took this View's place while this one was read.
    if (path !== this.path() || cwd !== this.cwd()) return;
    this.file.set(Exit.isSuccess(exit) ? exit.value : { status: 'failed', detail: Cause.pretty(exit.cause) });
  }

  // ---- Line selection ----------------------------------------------------------------------------------------------

  private select(selection: ReturnType<typeof clampLines>): void {
    this.selections.set(this.tabId(), this.path(), selection);
  }

  /** The line number under the pointer: the numbers are one column of lines of the same height. */
  private lineAt(event: MouseEvent, gutter: Element): number {
    const line = Math.floor((event.clientY - gutter.getBoundingClientRect().top) / LINE_HEIGHT) + 1;
    return Math.min(Math.max(line, 1), this.lineCount());
  }

  /** A press on a line number: selects it, or with shift extends from the anchor; a drag from here marks a range. */
  protected pressLine(event: MouseEvent): void {
    if (event.button !== 0) return;
    // The numbers mark lines, never the browser's text selection; the press still gives the View the keyboard (Esc).
    event.preventDefault();
    this.scroller()?.focus({ preventScroll: true });
    const current = this.selection();
    const line = this.lineAt(event, event.currentTarget as Element);
    if (!event.shiftKey && isOnlyLine(current, line)) {
      this.drag = { anchor: line, clears: true };
      return;
    }
    const next = clickLine(current, line, event.shiftKey);
    this.drag = { anchor: next.anchor, clears: false };
    this.select(next);
    this.measure();
  }

  /** The pointer moves with the button down after a press on a number: the range follows it. */
  protected dragLine(event: MouseEvent): void {
    const drag = this.drag;
    const gutter = this.host.nativeElement.querySelector('.gutter');
    if (drag === undefined || gutter === null) return;
    if (event.buttons === 0) return this.endDrag();
    const line = this.lineAt(event, gutter);
    if (drag.clears && line === drag.anchor) return;
    this.drag = { anchor: drag.anchor, clears: false };
    this.select(rangeFrom(drag.anchor, line));
    this.measure();
  }

  protected endDrag(): void {
    if (this.drag?.clears === true) this.clearSelection();
    this.drag = undefined;
  }

  protected clearSelection(): void {
    if (this.selection() !== undefined) this.select(undefined);
  }

  /** Reads how far the text is scrolled and how much of it shows: the popover flips above near the Pane's bottom. */
  protected measure(): void {
    const scroller = this.scroller();
    if (scroller === null) return;
    const next = { top: scroller.scrollTop, height: scroller.clientHeight };
    const current = this.viewport();
    if (current.top !== next.top || current.height !== next.height) this.viewport.set(next);
  }

  // ---- Actions of the popover and of the header ---------------------------------------------------------------------

  /** Copiar: the selected lines exactly, without their numbers; with no Line selection, the whole text that is shown. */
  copy(): void {
    const file = this.file();
    if (file.status !== 'text') return;
    const selection = this.selection();
    this.toClipboard(selection === undefined ? file.content : selectedText(file.content, selection));
  }

  /** Copiar ruta: the path in the Project with `/`, plus `:n` or `:start-end` with a Line selection. */
  copyPath(): void {
    this.toClipboard(pathWithLines(this.path(), this.selection()));
  }

  /** Opens the file outside Timmy, in the app the system has for it. */
  openExternal(): void {
    void this.runtime.run(openOutside(this.cwd(), this.path()));
  }

  private toClipboard(text: string): void {
    void this.runtime.run(Effect.tryPromise(() => navigator.clipboard.writeText(text)));
  }
}
