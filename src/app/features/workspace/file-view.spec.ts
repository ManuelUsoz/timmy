import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Deferred, Effect } from 'effect';
import { ProjectId } from '../../../shared/projects/projects.model';
import { TabId } from '../../../shared/workspace/workspace.model';
import { makeDesktopTestLayer } from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import { I18n } from '../../core/i18n';
import { FileView, DIFF_REFRESH_DEBOUNCE_MS } from './file-view';
import { ChangesRefreshSource } from './changes-refresh';
import type { HljsId, SymbolsId } from './file-language';
import { hunkOf, layerFakeFiles, makeFakeFiles, text } from './files-fakes';
import type { FileDiff } from '../../../shared/files/files.model';
import { LineSelections } from './line-selection';
import type { ColourRange } from './source-text';
import { SYMBOL_OUTLINER, outlineOf } from './symbol-outline';
import { MAX_COLOURED_LENGTH, SYNTAX_HIGHLIGHTER } from './syntax-highlighter';

const PROJECT = ProjectId.make('timmy');

@Component({
  imports: [FileView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-file-view cwd="/work/timmy" [path]="path()" [tabId]="tabId" [projectId]="projectId()" />`,
})
class Host {
  readonly path = signal('src/main.ts');
  readonly tabId = TabId.make('tab');
  readonly projectId = signal<ProjectId | undefined>(PROJECT);
}

interface SetupOptions {
  readonly files?: Record<string, string>;
  readonly path?: string;
  readonly diffs?: Record<string, FileDiff>;
  readonly debounce?: number;
  readonly projectId?: ProjectId | undefined;
}

/** A File View of `files` (by path) with a highlighter whose answers the test gives with `colour`. */
const setup = async (options: SetupOptions = {}) => {
  const fileMap = options.files ?? { 'src/main.ts': 'const a = 1;\n\nexport { a };\n' };
  const path = options.path ?? 'src/main.ts';
  const diffs = options.diffs ?? {};
  const debounce = options.debounce ?? 0;
  const projectId = options.projectId === undefined ? PROJECT : options.projectId;
  const fake = makeFakeFiles({
    disks: {
      '/work/timmy': {
        dirs: { '': [] },
        files: Object.fromEntries(Object.entries(fileMap).map(([file, content]) => [file, text(content)])),
        diffs,
        index: [],
      },
    },
  });
  const layer = makeDesktopTestLayer(layerFakeFiles(fake));
  /** What the File View asked to colour, in order, each waiting for its answer. */
  const asked: Array<{ readonly hljsId: HljsId; readonly answer: Deferred.Deferred<ReadonlyArray<ColourRange>> }> = [];
  /** What the File View asked Lezer to outline: the real outline, so a spec reads real symbols. */
  const outlined: Array<SymbolsId> = [];
  /** The refresh source the File View subscribes to. */
  const refreshTrigger = signal<{ readonly projectId: ProjectId } | undefined>(undefined);
  await TestBed.configureTestingModule({
    imports: [Host],
    providers: [
      {
        provide: SYMBOL_OUTLINER,
        useValue: {
          outline: (content: string, symbols: SymbolsId) => {
            outlined.push(symbols);
            return Effect.promise(() => outlineOf(content, symbols));
          },
        },
      },
      { provide: EffectRuntime, useValue: { run: (e: Effect.Effect<unknown, unknown, never>) => Effect.runPromiseExit(Effect.provide(e as never, layer)) } },
      { provide: DIFF_REFRESH_DEBOUNCE_MS, useValue: debounce },
      { provide: ChangesRefreshSource, useValue: { trigger: refreshTrigger } },
      {
        provide: SYNTAX_HIGHLIGHTER,
        useValue: {
          colours: (_content: string, hljsId: HljsId) =>
            Effect.gen(function* () {
              const answer = yield* Deferred.make<ReadonlyArray<ColourRange>>();
              asked.push({ hljsId, answer });
              return yield* Deferred.await(answer);
            }),
        },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.path.set(path);
  fixture.componentInstance.projectId.set(projectId);
  const el: HTMLElement = fixture.nativeElement;
  const settle = async (rounds = 4) => {
    for (let round = 0; round < rounds; round += 1) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve));
    }
  };
  await settle();
  const colour = async (ranges: ReadonlyArray<ColourRange>) => {
    Effect.runSync(Deferred.succeed(asked[0].answer, ranges));
    await settle();
  };
  /** Each line as it shows: plain text, a coloured run written `token(text)`. */
  const lines = () =>
    [...el.querySelectorAll('.line')].map((line) =>
      [...line.querySelectorAll('.text > span')].map((run) => (run.className === '' ? run.textContent : `${run.className.replace('tok-', '')}(${run.textContent})`)).join('|'),
    );
  const numbers = () => [...el.querySelectorAll('.line .number')].map((number) => number.textContent);
  const status = () => [...el.querySelectorAll('.status > span')].map((part) => part.textContent?.trim());
  /** The Breadcrumb as it reads, the strong parts (the file's name, the innermost symbol) written `*name*`. */
  const breadcrumb = () =>
    [...el.querySelectorAll('.breadcrumb .crumb')].map((crumb) => (crumb.classList.contains('strong') ? `*${crumb.textContent?.trim()}*` : crumb.textContent?.trim())).join(' › ');
  /** The gutter kind of each line, or '' when there is none. */
  const gutters = () =>
    [...el.querySelectorAll('.line')].map((line) => {
      const gutter = line.querySelector('.gutter');
      return gutter?.getAttribute('data-kind') ?? '';
    });
  /** The Archivo/Cambios toggle as it shows. */
  const mode = () => {
    const bar = el.querySelector('.mode-bar');
    if (bar === null) return { shown: false, on: 'file' as const, changes: '', enabled: false };
    const fileBtn = bar.querySelector<HTMLButtonElement>('button[data-mode=file]')!;
    const changesBtn = bar.querySelector<HTMLButtonElement>('button[data-mode=changes]')!;
    return {
      shown: true,
      on: fileBtn.getAttribute('aria-pressed') === 'true' ? ('file' as const) : ('changes' as const),
      changes: changesBtn.textContent?.trim() ?? '',
      enabled: !changesBtn.disabled,
    };
  };
  const t = (key: Parameters<I18n['t']>[0], params?: Parameters<I18n['t']>[1]) => TestBed.inject(I18n).t(key, params);
  /** Triggers a refresh for the File View's Project, as a Hook or window focus would. */
  const refresh = async () => {
    refreshTrigger.set({ projectId: PROJECT });
    await settle();
  };
  return { el, asked, outlined, colour, lines, numbers, status, breadcrumb, gutters, mode, t, refresh, settle, fake };
};

describe('A File View of source', () => {
  it('shows each line with its number as plain text first, then in colour when the colours arrive', async () => {
    const { asked, colour, lines, numbers } = await setup();
    expect(numbers()).toEqual(['1', '2', '3']);
    expect(lines()).toEqual(['const a = 1;', '', 'export { a };']);
    expect(asked.map((ask) => ask.hljsId)).toEqual(['typescript']);
    await colour([
      { line: 1, from: 0, to: 5, token: 'keyword' },
      { line: 1, from: 10, to: 11, token: 'number' },
      { line: 3, from: 0, to: 6, token: 'keyword' },
    ]);
    expect(lines()).toEqual(['keyword(const)| a = |number(1)|;', '', 'keyword(export)| { a };']);
  });

  it('does not colour a file with no language', async () => {
    const { asked, lines } = await setup({ files: { 'notes.txt': 'just words\n' }, path: 'notes.txt' });
    expect(lines()).toEqual(['just words']);
    expect(asked).toEqual([]);
  });

  it('keeps a file over the size limit plain', async () => {
    // Few long lines, so the DOM stays small: the limit counts characters, not lines.
    const line = `let a = '${'x'.repeat(4000)}';\n`;
    const big = line.repeat(Math.ceil(MAX_COLOURED_LENGTH / line.length) + 1);
    const { asked, lines } = await setup({ files: { 'big.ts': big }, path: 'big.ts' });
    expect(lines()[0]).toBe(line.trimEnd());
    expect(asked).toEqual([]);
  });

  it('says in its status bar the lines, the language, the line endings, the indent and the encoding', async () => {
    const { status } = await setup({ files: { 'src/main.ts': 'class A {\n  run() {\n    go();\n  }\n}\n' }, path: 'src/main.ts' });
    expect(status()).toEqual(['Ln –', 'TypeScript', 'LF', 'Espacios: 2', 'UTF-8']);
  });

  it('tells CRLF and tabs', async () => {
    const { status } = await setup({ files: { 'Main.java': 'class A {\r\n\tvoid run() {\r\n\t}\r\n}\r\n' }, path: 'Main.java' });
    expect(status()).toEqual(['Ln –', 'Java', 'CRLF', 'Tabulaciones', 'UTF-8']);
  });

  describe('Breadcrumb', () => {
    it('shows the path in the Project, then the declarations that hold line 1 while there is no Line selection', async () => {
      const { breadcrumb, outlined } = await setup({ files: { 'src/app/handshake.service.ts': 'export class HandshakeService {\n  connect() {}\n}\n' }, path: 'src/app/handshake.service.ts' });
      expect(outlined).toEqual(['typescript']);
      expect(breadcrumb()).toBe('src › app › *handshake.service.ts* › *HandshakeService*');
    });

    it('follows the start of the Line selection', async () => {
      const source = 'export class HandshakeService {\n  connect() {\n    go();\n  }\n\n  close() {\n    stop();\n  }\n}\n';
      const { el, breadcrumb, settle } = await setup({ files: { 'src/handshake.ts': source }, path: 'src/handshake.ts' });
      /** A click on a line's number, as the user marks a Line selection. */
      const click = async (line: number) => {
        el.querySelector(`.line[data-line="${line}"] .number`)?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        await settle();
      };
      await click(3);
      expect(breadcrumb()).toBe('src › *handshake.ts* › HandshakeService › *connect()*');
      await click(7);
      expect(breadcrumb()).toBe('src › *handshake.ts* › HandshakeService › *close()*');
    });

    it('shows Java symbols', async () => {
      const { breadcrumb } = await setup({ files: { 'Server.java': 'public class Server {\n  void start() {}\n}\n' }, path: 'Server.java' });
      expect(breadcrumb()).toBe('*Server.java* › *Server*');
    });

    it('shows the path alone for a line outside any declaration', async () => {
      const { breadcrumb } = await setup({ files: { 'src/main.ts': "import { a } from './a';\nexport class A {}\n" }, path: 'src/main.ts' });
      expect(breadcrumb()).toBe('src › *main.ts*');
    });

    it('shows the path alone for a language with no outline, without loading Lezer', async () => {
      const { breadcrumb, outlined } = await setup({ files: { 'scripts/build.py': 'class Build:\n  pass\n' }, path: 'scripts/build.py' });
      expect(breadcrumb()).toBe('scripts › *build.py*');
      expect(outlined).toEqual([]);
    });

    it('does not parse a file over the size limit: it shows the path alone', async () => {
      const line = `export const a = '${'x'.repeat(4000)}';\n`;
      const big = `export class Big {}\n${line.repeat(Math.ceil(MAX_COLOURED_LENGTH / line.length) + 1)}`;
      const { breadcrumb, outlined } = await setup({ files: { 'big.ts': big }, path: 'big.ts' });
      expect(breadcrumb()).toBe('*big.ts*');
      expect(outlined).toEqual([]);
    });
  });

  it('tells mixed line endings, and leaves out the indent of a file with none', async () => {
    const { status } = await setup({ files: { 'notes.txt': 'one\r\ntwo\nthree\n' }, path: 'notes.txt' });
    expect(status()).toEqual(['Ln –', 'Texto plano', 'Mixto', 'UTF-8']);
  });
});

describe('A File View jumped to (a Path link)', () => {
  const content = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`).join('\n');
  const scroller = (el: HTMLElement) => el.querySelector<HTMLElement>('.scroll')!;

  it('scrolls the marked lines to the middle of the View once its text is there', async () => {
    const { el, settle } = await setup({ files: { 'src/main.ts': content }, path: 'src/main.ts' });
    Object.defineProperty(scroller(el), 'clientHeight', { configurable: true, value: 180 });
    TestBed.inject(LineSelections).reveal(TabId.make('tab'), 'src/main.ts', 42);
    await settle();
    // Line 42 starts 41 lines down, 18 px each; its middle sits in the middle of 180 px.
    expect(scroller(el).scrollTop).toBe(41 * 18 + 9 - 90);
    expect(el.querySelector('.marks .selected')).not.toBeNull();
  });

  it('scrolls again when the same lines are jumped to after the user scrolled away, and centres a range', async () => {
    const { el, settle } = await setup({ files: { 'src/main.ts': content }, path: 'src/main.ts' });
    const selections = TestBed.inject(LineSelections);
    Object.defineProperty(scroller(el), 'clientHeight', { configurable: true, value: 180 });
    selections.reveal(TabId.make('tab'), 'src/main.ts', 42, 50);
    await settle();
    expect(scroller(el).scrollTop).toBe(((41 + 50) / 2) * 18 - 90);
    scroller(el).scrollTop = 0;
    selections.reveal(TabId.make('tab'), 'src/main.ts', 42, 50);
    await settle();
    expect(scroller(el).scrollTop).toBe(((41 + 50) / 2) * 18 - 90);
  });

  it('opens a line past the end at the top, with nothing marked', async () => {
    const { el, settle } = await setup({ files: { 'src/main.ts': content }, path: 'src/main.ts' });
    scroller(el).scrollTop = 300;
    TestBed.inject(LineSelections).reveal(TabId.make('tab'), 'src/main.ts', 400);
    await settle();
    expect(scroller(el).scrollTop).toBe(0);
    expect(el.querySelector('.marks .selected')).toBeNull();
  });

  it('leaves the jump to the File View of its own file', async () => {
    const { el, settle } = await setup({ files: { 'src/main.ts': content }, path: 'src/main.ts' });
    TestBed.inject(LineSelections).reveal(TabId.make('tab'), 'other.ts', 42);
    await settle();
    expect(scroller(el).scrollTop).toBe(0);
    expect(TestBed.inject(LineSelections).revealed()).toBeDefined();
  });
});

describe('A File View of a Changed file', () => {
  it('shows Archivo first, and Cambios with the same unified diff as the Quick look', async () => {
    const { el, mode, lines, t, settle } = await setup({
      files: { 'src/main.ts': '# timmy\n\nread me twice\n' },
      path: 'src/main.ts',
      diffs: { 'src/main.ts': hunkOf([' # timmy', ' ', '-read me', '+read me twice']) },
    });
    expect(mode()).toEqual({ shown: true, on: 'file', changes: t('quickLook.changes'), enabled: true });
    expect(lines()).toEqual(['# timmy', '', 'read me twice']);
    el.querySelector<HTMLButtonElement>('.mode-bar button[data-mode=changes]')!.click();
    await settle();
    expect(mode()).toEqual({ shown: true, on: 'changes', changes: t('quickLook.changes'), enabled: true });
    const diffRows = [...el.querySelectorAll('app-file-diff .row')].map((row) =>
      ['sign', 'old', 'new', 'text'].map((sel) => row.querySelector(`.${sel}`)?.textContent?.trim()).join('|'),
    );
    expect(diffRows).toEqual(['|1|1|# timmy', '|2|2|', '−|3||read me', '+||3|read me twice']);
  });

  it('keeps Cambios visible but disabled with "Sin cambios" on an unchanged file', async () => {
    const { mode, t } = await setup({ files: { 'src/main.ts': 'unchanged\n' }, path: 'src/main.ts' });
    expect(mode()).toEqual({ shown: true, on: 'file', changes: t('quickLook.noChanges'), enabled: false });
  });

  it('draws a gutter bar on added lines and a different bar on modified lines', async () => {
    const { gutters } = await setup({
      files: { 'src/main.ts': 'keep\nadd one\nadd two\nold\n' },
      path: 'src/main.ts',
      diffs: { 'src/main.ts': hunkOf([' keep', '+add one', '+add two', '-old line', '+old']) },
    });
    expect(gutters()).toEqual(['', 'added', 'added', 'modified']);
  });

  it('draws a notch where lines were deleted', async () => {
    const { gutters } = await setup({
      files: { 'src/main.ts': 'one\ntwo\nfive\n' },
      path: 'src/main.ts',
      diffs: { 'src/main.ts': hunkOf([' one', ' two', '-three', '-four', ' five']) },
    });
    expect(gutters()).toEqual(['', '', 'deleted']);
  });

  it('draws no gutter bars on a wholly untracked file, since its U already says it', async () => {
    const { gutters, mode, t } = await setup({
      files: { 'src/new.ts': 'first\nsecond\n' },
      path: 'src/new.ts',
      diffs: { 'src/new.ts': hunkOf(['+first', '+second'], true) },
    });
    expect(gutters()).toEqual(['', '']);
    expect(mode()).toEqual({ shown: true, on: 'file', changes: t('quickLook.changes'), enabled: true });
  });

  it('keeps the gutter aligned with the highlighted lines: one element per line', async () => {
    const { el, gutters, numbers } = await setup({
      files: { 'src/main.ts': 'a\nb\nc\nd\n' },
      path: 'src/main.ts',
      diffs: { 'src/main.ts': hunkOf([' a', '+b', '-c', '+d']) },
    });
    expect(numbers()).toEqual(['1', '2', '3', '4']);
    expect(gutters()).toEqual(['', 'added', 'modified', '']);
    const lineEls = [...el.querySelectorAll('.line')];
    expect(lineEls.every((line) => line.querySelector('.gutter') !== null)).toBe(true);
    expect(lineEls.every((line, index) => line.querySelector('.number')?.textContent === String(index + 1))).toBe(true);
  });

  it('reads the diff when it opens, and refreshes it on a shared trigger without showing loading', async () => {
    const { fake, mode, refresh, t, settle } = await setup({
      files: { 'src/main.ts': 'first\n' },
      path: 'src/main.ts',
      debounce: 0,
      diffs: { 'src/main.ts': hunkOf(['-start', '+first']) },
    });
    expect(mode()).toEqual({ shown: true, on: 'file', changes: t('quickLook.changes'), enabled: true });
    expect(fake.calls.filter((call) => call === 'Files.diff:src/main.ts')).toHaveLength(1);

    fake.disks['/work/timmy'].diffs!['src/main.ts'] = hunkOf(['-start', '+second']);
    await refresh();
    expect(fake.calls.filter((call) => call === 'Files.diff:src/main.ts')).toHaveLength(2);
    expect(mode()).toEqual({ shown: true, on: 'file', changes: t('quickLook.changes'), enabled: true });
  });

  it('ignores a refresh trigger for another Project', async () => {
    const { fake, refresh, settle } = await setup({
      files: { 'src/main.ts': 'first\n' },
      path: 'src/main.ts',
      debounce: 0,
    });
    expect(fake.calls.filter((call) => call === 'Files.diff:src/main.ts')).toHaveLength(1);
    TestBed.inject(ChangesRefreshSource).trigger.set({ projectId: ProjectId.make('other') });
    await settle();
    expect(fake.calls.filter((call) => call === 'Files.diff:src/main.ts')).toHaveLength(1);
  });
});
