import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Effect, Layer, Ref } from 'effect';
import type { FileContent, ImageContent } from '../../../shared/files/files.model';
import { defaultSettings, type Settings } from '../../../shared/settings/settings.model';
import { SettingsRpcs } from '../../../shared/settings/settings.rpc';
import { TabId } from '../../../shared/workspace/workspace.model';
import { makeDesktopTestLayer } from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import { FileView, MAX_RENDERED_LENGTH } from './file-view';
import { FilesBrowser } from './files-browser';
import { file, folder, layerFakeFiles, makeFakeFiles, text, type FakeDisk } from './files-fakes';
import { QuickLookState } from './quick-look-state';
import { SYNTAX_HIGHLIGHTER } from './syntax-highlighter';

@Component({
  imports: [FileView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-file-view cwd="/work/timmy" [path]="path()" [tabId]="tabId()" />`,
})
class Host {
  readonly path = signal('README.md');
  readonly tabId = signal<TabId | undefined>(TabId.make('tab'));
}

const png: ImageContent = { kind: 'image', type: 'image/png', bytes: new Uint8Array([1, 2, 3]), size: 3, width: 1, height: 1 };

interface Setup {
  readonly files: Record<string, FileContent>;
  readonly images?: Record<string, ImageContent>;
  readonly dirs?: FakeDisk['dirs'];
}

/** A File View of Markdown on a fake disk, with the reader setting kept by a fake main. */
const setup = async (disk: Setup, path = 'README.md', initial: Settings = { ...defaultSettings, reader: 'rendered' }) => {
  const fake = makeFakeFiles({ disks: { '/work/timmy': { index: [], ...disk, dirs: disk.dirs ?? { '': [] } } } });
  const stored = Ref.makeUnsafe(initial);
  const layerSettings = SettingsRpcs.toLayer({
    'Settings.get': () => Ref.get(stored),
    'Settings.setLanguage': () => Effect.die('unused'),
    'Settings.setProvider': () => Effect.die('unused'),
    'Settings.setChannel': () => Effect.die('unused'),
    'Settings.setReader': ({ reader }) => Ref.updateAndGet(stored, (settings) => ({ ...settings, reader })),
  });
  const layer = makeDesktopTestLayer(Layer.mergeAll(layerFakeFiles(fake), layerSettings));
  URL.createObjectURL = () => 'blob:timmy/1';
  URL.revokeObjectURL = () => undefined;
  await TestBed.configureTestingModule({
    imports: [Host],
    providers: [
      { provide: EffectRuntime, useValue: { run: (e: Effect.Effect<unknown, unknown, never>) => Effect.runPromiseExit(Effect.provide(e as never, layer)) } },
      { provide: SYNTAX_HIGHLIGHTER, useValue: { colours: () => Effect.succeed([]) } },
    ],
  }).compileComponents();
  const openFile = vi.spyOn(TestBed.inject(FilesBrowser), 'openFile').mockReturnValue(true);
  const reveal = vi.spyOn(TestBed.inject(FilesBrowser), 'reveal').mockReturnValue();
  const closeQuickLook = vi.spyOn(TestBed.inject(QuickLookState), 'close').mockReturnValue();
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.path.set(path);
  const el: HTMLElement = fixture.nativeElement;
  const settle = async () => {
    for (let round = 0; round < 12; round += 1) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  };
  await settle();
  const body = () => el.querySelector<HTMLElement>('.markdown-body');
  const modes = () =>
    [...el.querySelectorAll<HTMLButtonElement>('.modes button')].map(
      (button) => `${button.textContent?.trim()}${button.getAttribute('aria-pressed') === 'true' ? '*' : ''}${button.disabled ? '!' : ''}`,
    );
  const pick = async (mode: string) => {
    [...el.querySelectorAll<HTMLButtonElement>('.modes button')].find((button) => button.textContent?.trim() === mode)!.click();
    await settle();
  };
  /** A click that, if nothing stopped it, would navigate. */
  const click = async (target: Element) => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    await settle();
    return event;
  };
  return { fixture, el, fake, stored, settle, body, modes, pick, click, openFile, reveal, closeQuickLook, open };
};

const README = [
  '# Title',
  '',
  'Some *prose* with `code`.',
  '',
  '## Install now',
  '',
  '```ts',
  'const answer: number = 42;',
  '```',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  '![logo](img/logo.png)',
].join('\n');

const disk = (extra: Record<string, FileContent> = {}): Setup => ({
  files: { 'README.md': text(README), 'img/logo.png': { kind: 'binary' }, ...extra },
  images: { 'img/logo.png': png },
  dirs: { '': [folder('img'), folder('docs'), file('README.md')], img: [file('logo.png')], docs: [file('guide.md')] },
});

describe('A File View of Markdown', () => {
  it('renders headings with ids, highlighted code, a table and a relative image through Files.readImage', async () => {
    const { body, fake } = await setup(disk());
    expect(body()?.querySelector('h1')?.id).toBe('user-content-title');
    expect(body()?.querySelector('h2')?.id).toBe('user-content-install-now');
    expect(body()?.querySelector('pre code .tok-keyword')?.textContent).toBe('const');
    expect(body()?.querySelector('table td')?.textContent).toBe('1');
    expect(body()?.querySelector('img')?.getAttribute('src')).toBe('blob:timmy/1');
    expect(fake.calls).toContain('Files.readImage:img/logo.png');
  });

  it('opens in Fuente when that is the global choice, with the toggle on Fuente', async () => {
    const { body, modes, el } = await setup(disk(), 'README.md', defaultSettings);
    expect(body()).toBeNull();
    expect(modes()).toEqual(['Fuente*', 'Renderizado']);
    expect(el.querySelectorAll('.line').length).toBeGreaterThan(5);
  });

  it('toggles to Renderizado and back, and the choice is stored in main', async () => {
    const { body, modes, pick, stored, el } = await setup(disk(), 'README.md', defaultSettings);
    await pick('Renderizado');
    expect(body()).not.toBeNull();
    expect(modes()).toEqual(['Fuente', 'Renderizado*']);
    expect(Effect.runSync(Ref.get(stored)).reader).toBe('rendered');
    await pick('Fuente');
    expect(body()).toBeNull();
    expect(el.querySelector('.line')).not.toBeNull();
  });

  it('has no toggle for .mdx, which stays in Fuente whatever the setting says', async () => {
    const { body, modes, el } = await setup({ files: { 'page.mdx': text('# Hi\n\n<Chart />\n') } }, 'page.mdx');
    expect(body()).toBeNull();
    expect(modes()).toEqual([]);
    expect(el.querySelectorAll('.line').length).toBe(3);
  });

  it('disables the toggle above 512 KB, says why, and shows the source', async () => {
    const { body, modes, el } = await setup({ files: { 'BIG.md': text(`# Big\n${'x'.repeat(MAX_RENDERED_LENGTH)}\n`) } }, 'BIG.md');
    expect(body()).toBeNull();
    expect(modes()).toEqual(['Fuente', 'Renderizado*!']);
    expect(el.querySelector('.modes')?.getAttribute('title')).toBe('demasiado grande para renderizar');
    expect(el.querySelector('.line')).not.toBeNull();
  });

  it('has no Line selection in Renderizado, and the one made in Fuente is there again after the toggle', async () => {
    const { el, pick, settle } = await setup(disk(), 'README.md', defaultSettings);
    el.querySelector<HTMLElement>('.line[data-line="3"] .number')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await settle();
    expect(el.querySelector('.line-actions')).not.toBeNull();
    await pick('Renderizado');
    expect(el.querySelector('.line-actions')).toBeNull();
    expect(el.querySelector('.selected')).toBeNull();
    await pick('Fuente');
    expect(el.querySelector('.line-actions')).not.toBeNull();
  });

  it('copies only the path from Renderizado, and the text from Fuente', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    const { el, settle, pick } = await setup(disk(), 'README.md', defaultSettings);
    const view = el.querySelector('app-file-view')!;
    const instance = (window as unknown as { ng: { getComponent: (e: Element) => FileView } }).ng.getComponent(view);
    instance.copy();
    await settle();
    expect(write).toHaveBeenLastCalledWith(README);
    await pick('Renderizado');
    instance.copy();
    await settle();
    expect(write).toHaveBeenLastCalledWith('README.md');
  });
});

describe('Links in rendered Markdown', () => {
  const links = [
    '[file](docs/guide.md)',
    '[folder](docs/)',
    '[anchor](#install-now)',
    '[web](https://example.com/x)',
    '[escape](../../outside.md)',
    '[missing](nope.md)',
    '[script](javascript:alert(1))',
    '[http](http://example.com)',
    '[local](file:///etc/passwd)',
  ].join('\n\n');
  const withLinks = (): Setup => ({
    files: { 'README.md': text(`# T\n\n## Install now\n\n${links}`), 'docs/guide.md': text('# Guide') },
    dirs: { '': [folder('docs'), file('README.md')], docs: [file('guide.md')] },
  });
  const named = (body: HTMLElement | null, name: string) => [...(body?.querySelectorAll('a, .inert') ?? [])].find((a) => a.textContent === name)!;

  it('opens a link to a file of the Project as a preview File View and never navigates', async () => {
    const { body, click, openFile } = await setup(withLinks());
    const event = await click(named(body(), 'file'));
    expect(event.defaultPrevented).toBe(true);
    expect(openFile).toHaveBeenCalledWith('docs/guide.md');
  });

  it('reveals a folder in the tree', async () => {
    const { body, click, reveal, openFile } = await setup(withLinks());
    await click(named(body(), 'folder'));
    expect(reveal).toHaveBeenCalledWith('docs');
    expect(openFile).not.toHaveBeenCalled();
  });

  it('scrolls to a heading for an #anchor', async () => {
    const { body, click } = await setup(withLinks());
    const scroll = vi.fn();
    body()!.querySelector<HTMLElement>('#user-content-install-now')!.scrollIntoView = scroll;
    const event = await click(named(body(), 'anchor'));
    expect(scroll).toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('opens https in the external browser', async () => {
    const { body, click, open } = await setup(withLinks());
    await click(named(body(), 'web'));
    expect(open).toHaveBeenCalledWith('https://example.com/x', '_blank');
  });

  it('shows what leads nowhere as plain text with a tooltip, and nothing happens on a click', async () => {
    const { body, click, openFile, reveal, open } = await setup(withLinks());
    // markdown-it itself leaves javascript: and file: links as literal text, so those never become anchors.
    for (const name of ['escape', 'missing', 'http']) {
      const inert = named(body(), name);
      expect(inert.tagName, name).not.toBe('A');
      await click(inert);
    }
    expect(named(body(), 'missing').getAttribute('title')).toBe('Este enlace no lleva a ningún sitio del Proyecto');
    expect(openFile).not.toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('never lets a click in the page navigate, even on raw HTML', async () => {
    const { body, click } = await setup({ files: { 'README.md': text('<a href="https://evil.example" target="_top">raw</a>') } });
    const raw = [...body()!.querySelectorAll('a, span')].find((a) => a.textContent === 'raw')!;
    expect(raw.getAttribute('href')).toBe('#');
    expect((await click(raw)).defaultPrevented).toBe(true);
  });

  it('closes the Quick look first when a link is clicked in it', async () => {
    const { body, click, closeQuickLook, openFile, fixture, settle } = await setup(withLinks());
    fixture.componentInstance.tabId.set(undefined);
    await settle();
    await click(named(body(), 'file'));
    expect(closeQuickLook).toHaveBeenCalled();
    expect(openFile).toHaveBeenCalledWith('docs/guide.md');
  });
});

describe('Images in rendered Markdown', () => {
  const images = '![rel](img/a.png)\n\n![root](/img/a.png)\n\n![remote](https://example.com/a.png)\n\n![raw](file:///C:/a.png)\n\n![out](../../x.png)';

  it('reads relative images through Files.readImage, a leading slash being the Project root', async () => {
    const { body, fake } = await setup(
      {
        files: { 'docs/README.md': text(images), 'img/a.png': { kind: 'binary' }, 'docs/img/a.png': { kind: 'binary' } },
        images: { 'img/a.png': png, 'docs/img/a.png': png },
        dirs: { '': [folder('img'), folder('docs')], img: [file('a.png')], docs: [folder('img'), file('README.md')], 'docs/img': [file('a.png')] },
      },
      'docs/README.md',
    );
    expect(fake.calls.filter((call) => call.startsWith('Files.readImage')).sort()).toEqual(['Files.readImage:docs/img/a.png', 'Files.readImage:img/a.png']);
    await vi.waitFor(() => expect([...body()!.querySelectorAll('img')].filter((img) => img.getAttribute('src')?.startsWith('blob:') === true).length).toBe(2));
  });

  it('shows the alt text of a remote image and never fetches or sets it', async () => {
    const { body, fake } = await setup({ files: { 'README.md': text(images) } });
    const alts = [...body()!.querySelectorAll('.inert')].map((span) => span.textContent);
    expect(alts).toEqual(expect.arrayContaining(['remote', 'out']));
    expect(body()!.querySelectorAll('img[src^="http"], img[src^="file"]').length).toBe(0);
    expect(fake.calls.filter((call) => call.includes('example.com') || call.includes('file:'))).toEqual([]);
  });
});

describe('Sanitisation of rendered Markdown', () => {
  const hostile = [
    '<script>window.pwned = 1</script>',
    '',
    '<img src="x" onerror="window.pwned = 2">',
    '',
    '<a href="javascript:window.pwned=3" onclick="window.pwned=4" data-timmy-link="external" data-timmy-target="https://evil.example">click</a>',
    '',
    '<div onmouseover="window.pwned=5" style="position:fixed">raw <b>html</b></div>',
    '',
    '<iframe src="https://evil.example"></iframe><object data="x"></object><form action="x"><input></form>',
    '',
    '![x](file:///C:/secret.png) [y](file:///C:/secret.md) <img src="file:///C:/x.png"> <a href="file:///C:/x">z</a>',
  ].join('\n');

  it('neutralises scripts, event handlers, javascript: and raw HTML', async () => {
    const { body, el } = await setup({ files: { 'README.md': text(hostile) } });
    const page = body()!;
    expect(page.querySelectorAll('script, iframe, object, form, input').length).toBe(0);
    expect(page.querySelectorAll('[onerror], [onclick], [onmouseover], [style]').length).toBe(0);
    expect(page.innerHTML).not.toContain('javascript:');
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
    expect(page.querySelector('b')?.textContent).toBe('html');
    expect(el.querySelector('script')).toBeNull();
  });

  it('never lets a README name where a click goes, and never puts a file: URL in the DOM', async () => {
    const { body, open, click } = await setup({ files: { 'README.md': text(hostile) } });
    const page = body()!;
    expect(page.querySelectorAll('[data-timmy-link="external"]').length).toBe(0);
    const destinations = [...page.querySelectorAll('[src], [href]')].map((e) => e.getAttribute('src') ?? e.getAttribute('href') ?? '');
    expect(destinations.filter((value) => /^(?:file|javascript):/i.test(value))).toEqual([]);
    await click(page.querySelector('a, span')!);
    expect(open).not.toHaveBeenCalled();
  });
});

describe('The Quick look and Markdown', () => {
  it('follows the global setting with no toggle of its own', async () => {
    const { body, modes, fixture, settle } = await setup(disk());
    fixture.componentInstance.tabId.set(undefined);
    await settle();
    expect(body()).not.toBeNull();
    expect(modes()).toEqual([]);
  });

  it('shows Fuente in the Quick look when the setting is Fuente', async () => {
    const { body, el, fixture, settle } = await setup(disk(), 'README.md', defaultSettings);
    fixture.componentInstance.tabId.set(undefined);
    await settle();
    expect(body()).toBeNull();
    expect(el.querySelector('.line')).not.toBeNull();
  });
});
