import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, effect, inject, input, signal, untracked, Injector } from '@angular/core';
import { Cause, Effect, Exit } from 'effect';
import { DesktopApi } from '../../core/desktop-api';
import { EffectRuntime } from '../../core/effect-runtime';
import { I18n } from '../../core/i18n';
import type { TabId } from './tabs';
import { TabsState } from './tabs-state';
import { PLAIN_TEXT, languageOf } from './file-language';
import { columnsOf, eolOf, indentOf, lineRuns, linesOf, type ColourRange, type LineRange } from './source-text';
import { SYMBOL_OUTLINER, type Outline } from './symbol-outline';
import { MAX_COLOURED_LENGTH, SYNTAX_HIGHLIGHTER } from './syntax-highlighter';
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

/** `2.5 MB`: the size of a file too large to preview. */
export const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * The body of a File View (GLOSSARY: File View, ADR 0013): one file of the Project, read-only, one element per line
 * with its number, highlighted by language (`file-language.ts`) once the worker colours it, under a Breadcrumb (in a
 * Tab; the Quick look's header has the path) and above a status bar; or the
 * state that says why it is not shown (binary, too large, gone, unreadable). It reads the file when it opens and when its path changes (a preview replaced). A file picked in the tree gives it the keyboard
 * (`TabsState.focusRequest`), so the user can scroll at once. Its header is the Pane's (`PaneStack`).
 */
@Component({
  selector: 'app-file-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './file-view.html',
  styleUrl: './file-view.css',
})
export class FileView {
  protected readonly i18n = inject(I18n);
  private readonly runtime = inject(EffectRuntime);
  private readonly tabs = inject(TabsState);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly highlighter = inject(SYNTAX_HIGHLIGHTER);
  private readonly outliner = inject(SYMBOL_OUTLINER);

  /** The Project's folder, which the path is relative to. */
  readonly cwd = input.required<string>();
  readonly path = input.required<string>();
  /** The Tab it is in, to tell a request for the keyboard meant for it. None outside a Tab (the Quick look). */
  readonly tabId = input<TabId>();

  protected readonly file = signal<FileState>({ status: 'loading' });
  protected readonly name = computed(() => this.path().split('/').at(-1) ?? this.path());

  /** The text of the file, empty while it is not text. */
  private readonly content = computed(() => {
    const file = this.file();
    return file.status === 'text' ? file.content : '';
  });
  protected readonly lines = computed(() => linesOf(this.content()));
  /** The colours of the lines, none until the worker gives them (and never for plain text or a large file). */
  private readonly colours = signal<ReadonlyArray<ColourRange>>([]);
  /** Each line as the runs to draw. */
  protected readonly rows = computed(() => lineRuns(this.lines(), this.colours()));
  /** The width the longest line needs, in characters: a line out of view is not laid out, so the text cannot measure it. */
  protected readonly columns = computed(() => columnsOf(this.lines()));
  /** How many digits the last line number has, which is the width of the numbers. */
  protected readonly digits = computed(() => String(this.lines().length).length);
  protected readonly language = computed(() => languageOf(this.name()));
  /** The Line selection; none yet. */
  protected readonly selection = signal<LineRange | undefined>(undefined);

  /** The symbols of each line, once Lezer has outlined the text; never for a file with no outline or a large one. */
  private readonly outline = signal<Outline | undefined>(undefined);
  /**
   * The Breadcrumb (GLOSSARY): the folders, the file's name, then the declarations that hold the Line selection's start
   * (line 1 with none). The file's name and the innermost symbol are strong.
   */
  protected readonly breadcrumb = computed(() => {
    const folders = this.path().split('/');
    const name = folders.pop() ?? '';
    const symbols = this.outline()?.(this.selection()?.from ?? 1) ?? [];
    return [
      ...folders.map((text) => ({ text, strong: false })),
      { text: name, strong: true },
      ...symbols.map((text, index) => ({ text, strong: index === symbols.length - 1 })),
    ];
  });

  /** The status bar: lines, language, line endings, indent guess and a fixed encoding. */
  protected readonly status = computed(() => {
    const selection = this.selection();
    const span = selection === undefined ? '' : selection.from === selection.to ? `${selection.from}` : `${selection.from}–${selection.to}`;
    const lines = selection === undefined ? this.i18n.t('fileView.noLines') : this.i18n.t('fileView.lines', { lines: span, total: this.lines().length });
    const language = this.language();
    const eol = eolOf(this.content());
    const indent = indentOf(this.lines());
    return [
      lines,
      language === PLAIN_TEXT ? this.i18n.t('fileView.plainText') : language.name,
      ...(eol === undefined ? [] : [eol === 'Mixed' ? this.i18n.t('fileView.mixedEol') : eol]),
      ...(indent === undefined ? [] : [indent.kind === 'tabs' ? this.i18n.t('fileView.tabs') : this.i18n.t('fileView.spaces', { size: indent.size })]),
      'UTF-8',
    ];
  });

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
        afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('.scroll')?.focus(), { injector: this.injector });
      });
    });
  }

  protected size(bytes: number): string {
    return formatSize(bytes);
  }

  private async read(cwd: string, path: string): Promise<void> {
    this.file.set({ status: 'loading' });
    const exit = await this.runtime.run(readFile(cwd, path));
    // Another file took this View's place while this one was read.
    if (path !== this.path() || cwd !== this.cwd()) return;
    const file: FileState = Exit.isSuccess(exit) ? exit.value : { status: 'failed', detail: Cause.pretty(exit.cause) };
    this.colours.set([]);
    this.outline.set(undefined);
    this.file.set(file);
    if (file.status !== 'text') return;
    void this.colour(cwd, path, file.content);
    void this.outlineText(cwd, path, file.content);
  }

  /** Has Lezer outline a text whose language has symbols and that is not too large; only the path shows meanwhile. */
  private async outlineText(cwd: string, path: string, content: string): Promise<void> {
    const { symbols } = this.language();
    if (symbols === undefined || content.length > MAX_COLOURED_LENGTH) return;
    const exit = await this.runtime.run(this.outliner.outline(content, symbols));
    if (path !== this.path() || cwd !== this.cwd() || this.content() !== content) return;
    if (Exit.isSuccess(exit)) this.outline.set(exit.value);
  }

  /** Asks the worker for the colours of a text that has a language and is not too large; the plain text shows meanwhile. */
  private async colour(cwd: string, path: string, content: string): Promise<void> {
    const { hljsId } = this.language();
    if (hljsId === undefined || content.length > MAX_COLOURED_LENGTH) return;
    const exit = await this.runtime.run(this.highlighter.colours(content, hljsId));
    // Another file, or another read of this one, took its place meanwhile.
    if (path !== this.path() || cwd !== this.cwd() || this.content() !== content) return;
    if (Exit.isSuccess(exit)) this.colours.set(exit.value);
  }
}
