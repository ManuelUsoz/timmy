import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Effect, Layer, Ref } from 'effect';
import type { FileContent, ImageContent, ImageType } from '../../../shared/files/files.model';
import { defaultSettings, type Settings } from '../../../shared/settings/settings.model';
import { SettingsRpcs } from '../../../shared/settings/settings.rpc';
import { TabId } from '../../../shared/workspace/workspace.model';
import { makeDesktopTestLayer } from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import { FileView } from './file-view';
import { layerFakeFiles, makeFakeFiles, text, type FakeDisk } from './files-fakes';
import { SYNTAX_HIGHLIGHTER } from './syntax-highlighter';

@Component({
  imports: [FileView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-file-view cwd="/work/timmy" [path]="path()" [tabId]="tabId" />
    @if (second()) {
      <app-file-view class="second" cwd="/work/timmy" [path]="second()!" [tabId]="tabId" />
    }
  `,
})
class Host {
  readonly path = signal('img/logo.png');
  readonly second = signal<string | undefined>(undefined);
  readonly tabId = TabId.make('tab');
}

const image = (type: ImageType, width: number | null, height: number | null, size: number): ImageContent => ({
  kind: 'image',
  type,
  bytes: new Uint8Array([1, 2, 3]),
  size,
  width,
  height,
});

const HOSTILE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><foreignObject><iframe src="https://evil.example"/></foreignObject></svg>';

interface Disk {
  readonly files: Record<string, FileContent>;
  readonly images?: Record<string, ImageContent>;
  readonly unreadable?: ReadonlyArray<string>;
}

/** A File View on a fake disk, with the reader setting kept by a fake main (`stored`) and the blobs it made kept in `blobs`. */
const setup = async (disk: Disk, path: string, initial: Settings = defaultSettings) => {
  const fakeDisk: FakeDisk = { dirs: { '': [] }, index: [], ...disk };
  const fake = makeFakeFiles({ disks: { '/work/timmy': fakeDisk } });
  const stored = Ref.makeUnsafe(initial);
  const layerSettings = SettingsRpcs.toLayer({
    'Settings.get': () => Ref.get(stored),
    'Settings.setLanguage': () => Effect.die('unused'),
    'Settings.setProvider': () => Effect.die('unused'),
    'Settings.setChannel': () => Effect.die('unused'),
    'Settings.setReader': ({ reader }) => Ref.updateAndGet(stored, (settings) => ({ ...settings, reader })),
  });
  const layer = makeDesktopTestLayer(Layer.mergeAll(layerFakeFiles(fake), layerSettings));
  const blobs: Blob[] = [];
  const revoked: string[] = [];
  URL.createObjectURL = (blob: Blob) => {
    blobs.push(blob);
    return `blob:timmy/${blobs.length}`;
  };
  URL.revokeObjectURL = (url: string) => void revoked.push(url);
  await TestBed.configureTestingModule({
    imports: [Host],
    providers: [
      { provide: EffectRuntime, useValue: { run: (e: Effect.Effect<unknown, unknown, never>) => Effect.runPromiseExit(Effect.provide(e as never, layer)) } },
      { provide: SYNTAX_HIGHLIGHTER, useValue: { colours: () => Effect.succeed([]) } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.path.set(path);
  const el: HTMLElement = fixture.nativeElement;
  const settle = async () => {
    for (let round = 0; round < 5; round += 1) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve));
    }
  };
  await settle();
  const view = (which = 'app-file-view') => el.querySelector<HTMLElement>(which)!;
  const status = (which?: string) => [...view(which).querySelectorAll('.status > span')].map((part) => part.textContent?.trim());
  const note = (which?: string) => view(which).querySelector('.note')?.textContent?.trim();
  const buttons = (which?: string) => [...view(which).querySelectorAll('.state-actions button')].map((button) => button.textContent?.trim());
  const picture = (which?: string) => view(which).querySelector<HTMLImageElement>('.picture img');
  const modes = (which?: string) =>
    [...view(which).querySelectorAll<HTMLButtonElement>('.modes button')].map((button) => `${button.textContent?.trim()}${button.getAttribute('aria-pressed') === 'true' ? '*' : ''}`);
  const pick = async (mode: string, which?: string) => {
    [...view(which).querySelectorAll<HTMLButtonElement>('.modes button')].find((button) => button.textContent?.trim() === mode)!.click();
    await settle();
  };
  const lines = (which?: string) => [...view(which).querySelectorAll('.line .text')].map((line) => line.textContent);
  return { fixture, el, fake, stored, blobs, revoked, settle, view, status, note, buttons, picture, modes, pick, lines };
};

describe('A File View of an image', () => {
  it('shows the picture from a blob of its type, fitted, with its size in pixels, its weight and its kind in the status bar', async () => {
    const { blobs, picture, status, view, lines } = await setup(
      { files: { 'img/logo.png': { kind: 'binary' } }, images: { 'img/logo.png': image('image/png', 640, 480, 12_800) } },
      'img/logo.png',
    );
    expect(picture()?.getAttribute('src')).toBe('blob:timmy/1');
    expect(blobs.map((blob) => blob.type)).toEqual(['image/png']);
    expect(view().querySelector('.picture')?.classList.contains('actual')).toBe(false);
    expect(status()).toEqual(['640 × 480', '12.5 KB', 'PNG']);
    expect(lines()).toEqual([]);
  });

  it('shows a picture renamed with a text extension, since main reads its type from the bytes', async () => {
    const { picture, status } = await setup(
      { files: { 'notes.txt': { kind: 'binary' } }, images: { 'notes.txt': image('image/jpeg', 10, 20, 300) } },
      'notes.txt',
    );
    expect(picture()).not.toBeNull();
    expect(status()).toEqual(['10 × 20', '300 B', 'JPEG']);
  });

  it('shows a picture over the text limit, which only the image read can tell', async () => {
    const { picture } = await setup(
      { files: { 'big.webp': { kind: 'tooLarge', size: 3_000_000 } }, images: { 'big.webp': image('image/webp', 4000, 3000, 3_000_000) } },
      'big.webp',
    );
    expect(picture()).not.toBeNull();
  });

  it('toggles actual size with a click or 1, and back to fitted', async () => {
    const { view, picture, settle } = await setup(
      { files: { 'a.png': { kind: 'binary' } }, images: { 'a.png': image('image/png', 4000, 3000, 9000) } },
      'a.png',
    );
    const frame = () => view().querySelector('.picture')!;
    picture()!.click();
    await settle();
    expect(frame().classList.contains('actual')).toBe(true);
    view().querySelector('.scroll')!.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
    await settle();
    expect(frame().classList.contains('actual')).toBe(false);
    view().querySelector('.scroll')!.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
    await settle();
    expect(frame().classList.contains('actual')).toBe(true);
  });

  it('lets the blob go when another file takes the View', async () => {
    const { fixture, settle, revoked } = await setup(
      { files: { 'a.png': { kind: 'binary' }, 'b.ts': text('x') }, images: { 'a.png': image('image/png', 1, 1, 10) } },
      'a.png',
    );
    fixture.componentInstance.path.set('b.ts');
    await settle();
    expect(revoked).toEqual(['blob:timmy/1']);
  });
});

describe('A File View that cannot show its file', () => {
  it('says a binary file is binary, with its size, and offers to open it outside Timmy', async () => {
    const { note, buttons, view, settle, fake } = await setup(
      { files: { 'doc.pdf': { kind: 'binary' } }, images: { 'doc.pdf': { kind: 'notAnImage', size: 2048 } } },
      'doc.pdf',
    );
    expect(note()).toBe('Archivo binario, 2.0 KB');
    expect(buttons()).toEqual(['Abrir fuera de Timmy']);
    view().querySelector<HTMLButtonElement>('.state-actions button')!.click();
    await settle();
    expect(fake.calls).toContain('Files.openExternal:doc.pdf');
  });

  it('says text over the limit is too large, with its size, and offers to open it outside Timmy', async () => {
    const { note, buttons } = await setup(
      { files: { 'big.log': { kind: 'tooLarge', size: 3 * 1024 * 1024 } }, images: { 'big.log': { kind: 'notAnImage', size: 3 * 1024 * 1024 } } },
      'big.log',
    );
    expect(note()).toBe('Demasiado grande para previsualizar (3.0 MB)');
    expect(buttons()).toEqual(['Abrir fuera de Timmy']);
  });

  it('names the cap an image is over, bytes or pixels', async () => {
    const heavy = await setup(
      { files: { 'heavy.png': { kind: 'tooLarge', size: 9 * 1024 * 1024 } }, images: { 'heavy.png': { kind: 'tooLarge', limit: 'bytes', size: 9 * 1024 * 1024 } } },
      'heavy.png',
    );
    expect(heavy.note()).toBe('Imagen de más de 8 MiB (9.0 MB)');
    expect(heavy.buttons()).toEqual(['Abrir fuera de Timmy']);
    TestBed.resetTestingModule();
    const huge = await setup(
      { files: { 'huge.png': { kind: 'binary' } }, images: { 'huge.png': { kind: 'tooLarge', limit: 'pixels', size: 1000, width: 16000, height: 16000 } } },
      'huge.png',
    );
    expect(huge.note()).toBe('Imagen de más de 40 megapíxeles (16000 × 16000)');
    expect(huge.buttons()).toEqual(['Abrir fuera de Timmy']);
  });

  it('says an unreadable file cannot be read, with Reintentar, which reads it again', async () => {
    const { note, buttons, view, settle, fake, fixture } = await setup({ files: { 'locked.png': { kind: 'binary' } }, unreadable: ['locked.png'] }, 'locked.png');
    expect(note()).toBe('No se puede leer el archivo');
    expect(buttons()).toEqual(['Reintentar', 'Abrir fuera de Timmy']);
    fake.disks['/work/timmy']!.unreadable = [];
    fake.disks['/work/timmy']!.images = { 'locked.png': image('image/png', 2, 2, 40) };
    view().querySelector<HTMLButtonElement>('.state-actions button')!.click();
    await settle();
    expect(fixture.nativeElement.querySelector('.picture img')).not.toBeNull();
  });

  it('offers nothing for a file that is gone', async () => {
    const { note, buttons } = await setup({ files: {} }, 'gone.png');
    expect(note()).toBe('El archivo ya no existe');
    expect(buttons()).toEqual([]);
  });
});

describe('A File View of an SVG', () => {
  it('opens as highlighted text, with Fuente chosen, and reads it as an image only when Imagen is chosen', async () => {
    const { lines, modes, picture, pick, fake, status, blobs } = await setup(
      { files: { 'logo.svg': text('<svg>\n</svg>\n') }, images: { 'logo.svg': image('image/svg+xml', null, null, 14) } },
      'logo.svg',
    );
    expect(lines()).toEqual(['<svg>', '</svg>']);
    expect(modes()).toEqual(['Fuente*', 'Imagen']);
    expect(picture()).toBeNull();
    expect(fake.calls.filter((call) => call.startsWith('Files.readImage'))).toEqual([]);
    await pick('Imagen');
    expect(modes()).toEqual(['Fuente', 'Imagen*']);
    expect(picture()?.getAttribute('src')).toBe('blob:timmy/1');
    expect(blobs.map((blob) => blob.type)).toEqual(['image/svg+xml']);
    expect(lines()).toEqual([]);
    expect(status()).toEqual(['14 B', 'SVG']);
    await pick('Fuente');
    expect(lines()).toEqual(['<svg>', '</svg>']);
  });

  it('keeps the choice for every View and in main, so it holds after a restart', async () => {
    const { fixture, settle, pick, modes, picture, stored } = await setup(
      {
        files: { 'a.svg': text('<svg/>'), 'b.svg': text('<svg/>') },
        images: { 'a.svg': image('image/svg+xml', null, null, 6), 'b.svg': image('image/svg+xml', null, null, 6) },
      },
      'a.svg',
    );
    fixture.componentInstance.second.set('b.svg');
    await settle();
    await pick('Imagen');
    expect(modes('.second')).toEqual(['Fuente', 'Imagen*']);
    expect(picture('.second')).not.toBeNull();
    expect(Effect.runSync(Ref.get(stored)).reader).toBe('rendered');
  });

  it('opens in Imagen when that was the last choice, as stored in main', async () => {
    const { modes, picture } = await setup(
      { files: { 'a.svg': text('<svg/>') }, images: { 'a.svg': image('image/svg+xml', null, null, 6) } },
      'a.svg',
      { ...defaultSettings, reader: 'rendered' },
    );
    expect(modes()).toEqual(['Fuente', 'Imagen*']);
    expect(picture()).not.toBeNull();
  });

  it('never puts a hostile SVG in the page as markup, as text or as an image', async () => {
    const { el, pick, blobs, picture } = await setup(
      { files: { 'evil.svg': text(HOSTILE_SVG) }, images: { 'evil.svg': image('image/svg+xml', null, null, HOSTILE_SVG.length) } },
      'evil.svg',
    );
    const markup = () => el.querySelectorAll('svg, script, iframe, object, embed, foreignObject').length;
    expect(markup()).toBe(0);
    await pick('Imagen');
    expect(markup()).toBe(0);
    expect(picture()?.getAttribute('src')).toMatch(/^blob:/);
    expect(blobs.map((blob) => blob.type)).toEqual(['image/svg+xml']);
  });

  it('says a file named .svg that is not an SVG cannot be shown as an image, keeping the way back to Fuente', async () => {
    const { pick, note, modes } = await setup({ files: { 'odd.svg': text('hello') }, images: { 'odd.svg': { kind: 'notAnImage', size: 5 } } }, 'odd.svg');
    await pick('Imagen');
    expect(note()).toBe('No se puede mostrar como imagen');
    expect(modes()).toEqual(['Fuente', 'Imagen*']);
  });
});
