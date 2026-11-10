import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Deferred, Effect } from 'effect';
import { TabId } from '../../../shared/workspace/workspace.model';
import { makeDesktopTestLayer } from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import { FileView } from './file-view';
import type { HljsId } from './file-language';
import { layerFakeFiles, makeFakeFiles, text } from './files-fakes';
import type { ColourRange } from './source-text';
import { MAX_COLOURED_LENGTH, SYNTAX_HIGHLIGHTER } from './syntax-highlighter';

@Component({
  imports: [FileView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-file-view cwd="/work/timmy" [path]="path()" [tabId]="tabId" />`,
})
class Host {
  readonly path = signal('src/main.ts');
  readonly tabId = TabId.make('tab');
}

/** A File View of `files` (by path) with a highlighter whose answers the test gives with `colour`. */
const setup = async (files: Record<string, string>, path: string) => {
  const fake = makeFakeFiles({ disks: { '/work/timmy': { dirs: { '': [] }, files: Object.fromEntries(Object.entries(files).map(([file, content]) => [file, text(content)])), index: [] } } });
  const layer = makeDesktopTestLayer(layerFakeFiles(fake));
  /** What the File View asked to colour, in order, each waiting for its answer. */
  const asked: Array<{ readonly hljsId: HljsId; readonly answer: Deferred.Deferred<ReadonlyArray<ColourRange>> }> = [];
  await TestBed.configureTestingModule({
    imports: [Host],
    providers: [
      { provide: EffectRuntime, useValue: { run: (e: Effect.Effect<unknown, unknown, never>) => Effect.runPromiseExit(Effect.provide(e as never, layer)) } },
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
  const el: HTMLElement = fixture.nativeElement;
  const settle = async () => {
    for (let round = 0; round < 4; round += 1) {
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
  return { el, asked, colour, lines, numbers, status, settle };
};

describe('A File View of source', () => {
  it('shows each line with its number as plain text first, then in colour when the colours arrive', async () => {
    const { asked, colour, lines, numbers } = await setup({ 'src/main.ts': 'const a = 1;\n\nexport { a };\n' }, 'src/main.ts');
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
    const { asked, lines } = await setup({ 'notes.txt': 'just words\n' }, 'notes.txt');
    expect(lines()).toEqual(['just words']);
    expect(asked).toEqual([]);
  });

  it('keeps a file over the size limit plain', async () => {
    // Few long lines, so the DOM stays small: the limit counts characters, not lines.
    const line = `let a = '${'x'.repeat(4000)}';\n`;
    const big = line.repeat(Math.ceil(MAX_COLOURED_LENGTH / line.length) + 1);
    const { asked, lines } = await setup({ 'big.ts': big }, 'big.ts');
    expect(lines()[0]).toBe(line.trimEnd());
    expect(asked).toEqual([]);
  });

  it('says in its status bar the lines, the language, the line endings, the indent and the encoding', async () => {
    const { status } = await setup({ 'src/main.ts': 'class A {\n  run() {\n    go();\n  }\n}\n' }, 'src/main.ts');
    expect(status()).toEqual(['Ln –', 'TypeScript', 'LF', 'Espacios: 2', 'UTF-8']);
  });

  it('tells CRLF and tabs', async () => {
    const { status } = await setup({ 'Main.java': 'class A {\r\n\tvoid run() {\r\n\t}\r\n}\r\n' }, 'Main.java');
    expect(status()).toEqual(['Ln –', 'Java', 'CRLF', 'Tabulaciones', 'UTF-8']);
  });

  it('tells mixed line endings, and leaves out the indent of a file with none', async () => {
    const { status } = await setup({ 'notes.txt': 'one\r\ntwo\nthree\n' }, 'notes.txt');
    expect(status()).toEqual(['Ln –', 'Texto plano', 'Mixto', 'UTF-8']);
  });
});
