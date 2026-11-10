import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Effect, Layer, Stream } from 'effect';
import { NotificationRpcs } from '../../../shared/notification/notification.rpc';
import { makeDesktopTestLayer } from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import { FileView } from './file-view';
import { LineSelections } from './line-selection';
import { layerFakeBackend, layerFakeWorkspace, makeBackend, project } from './projects-fakes';
import { TabId } from './tabs';

const timmy = project('timmy');
const tab = TabId.make('tab-1');
/** The height of a line of the File View, in px: where a pointer is tells which line number it is on. */
const LINE = 18;
const TEN_LINES = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join('\n') + '\n';

@Component({
  imports: [FileView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-file-view cwd="/work/timmy" [path]="path()" [tabId]="tab" />`,
})
class Host {
  readonly tab = tab;
  readonly path = signal('src/main.ts');
}

const setup = async (content = TEN_LINES) => {
  const backend = makeBackend({ projects: [timmy] });
  backend.files.disks['/work/timmy'] = { dirs: { '': [] }, files: { 'src/main.ts': { kind: 'text', content }, 'logo.png': { kind: 'binary' } }, index: [] };
  const layer = makeDesktopTestLayer(Layer.mergeAll(layerFakeBackend(backend), layerFakeWorkspace(backend), NotificationRpcs.toLayer({ 'Notification.subscribe': () => Stream.empty })));
  const copied: string[] = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => void copied.push(value) } });
  await TestBed.configureTestingModule({
    imports: [Host],
    providers: [{ provide: EffectRuntime, useValue: { run: (e: Effect.Effect<unknown, unknown, never>) => Effect.runPromiseExit(Effect.provide(e as never, layer)) } }],
  }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  const el = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r));
      fixture.detectChanges();
    }
  };
  fixture.detectChanges();
  await settle();

  const scroll = () => el.querySelector<HTMLElement>('.scroll')!;
  const gutter = () => el.querySelector<HTMLElement>('.gutter')!;
  const at = (line: number) => ({ clientY: (line - 1) * LINE + LINE / 2, bubbles: true, cancelable: true });
  const down = async (line: number, shiftKey = false) => {
    gutter().dispatchEvent(new MouseEvent('mousedown', { ...at(line), shiftKey }));
    await settle();
  };
  const moveTo = async (line: number) => {
    gutter().dispatchEvent(new MouseEvent('mousemove', { ...at(line), buttons: 1 }));
    await settle();
  };
  const up = async () => {
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await settle();
  };
  /** A click on a line number; with shift it extends from the anchor. */
  const click = async (line: number, shiftKey = false) => {
    await down(line, shiftKey);
    await up();
  };
  const escape = async () => {
    scroll().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
  };
  /** The marked lines as the tint covers them, `3-5` (or `3`); undefined with no Line selection. */
  const selected = () => {
    const mark = el.querySelector<HTMLElement>('.selected');
    if (mark === null) return undefined;
    const first = parseFloat(mark.style.top) / LINE + 1;
    const count = parseFloat(mark.style.height) / LINE;
    return count === 1 ? `${first}` : `${first}-${first + count - 1}`;
  };
  const popover = () => el.querySelector<HTMLElement>('.line-actions');
  const action = (label: string) => Array.from(popover()?.querySelectorAll('button') ?? []).find((button) => button.textContent?.trim() === label);
  const press = async (button: HTMLElement | undefined) => {
    if (button === undefined) throw new Error('nothing to press');
    button.click();
    await settle();
  };
  /** The Pane shows `height` px of the text, scrolled `top` px down. */
  const viewport = async (height: number, top = 0) => {
    Object.defineProperty(scroll(), 'clientHeight', { configurable: true, value: height });
    Object.defineProperty(scroll(), 'scrollTop', { configurable: true, value: top });
    scroll().dispatchEvent(new Event('scroll'));
    await settle();
  };
  return { el, host: fixture.componentInstance, selections: TestBed.inject(LineSelections), copied, settle, click, down, moveTo, up, escape, selected, popover, action, press, viewport, scroll };
};

describe('A Line selection in a File View', () => {
  it('has none until a line number is clicked, which selects that line', async () => {
    const { click, selected, popover } = await setup();
    expect(selected()).toBeUndefined();
    expect(popover()).toBeNull();
    await click(3);
    expect(selected()).toBe('3');
  });

  it('extends from the anchor with shift-click, up or down, and stays one contiguous range', async () => {
    const { click, selected } = await setup();
    await click(4);
    await click(7, true);
    expect(selected()).toBe('4-7');
    // The anchor stays where the first click put it.
    await click(2, true);
    expect(selected()).toBe('2-4');
    // A plain click starts again: never two ranges.
    await click(9);
    expect(selected()).toBe('9');
  });

  it('selects a range by dragging down (or up) the numbers', async () => {
    const { down, moveTo, up, selected } = await setup();
    await down(2);
    await moveTo(5);
    expect(selected()).toBe('2-5');
    await moveTo(1);
    expect(selected()).toBe('1-2');
    await up();
    // The button is up: moving over the numbers marks nothing more.
    await moveTo(8);
    expect(selected()).toBe('1-2');
  });

  it('clears on a click on the only selected line, and on Esc', async () => {
    const { click, escape, selected, popover } = await setup();
    await click(3);
    await click(3);
    expect(selected()).toBeUndefined();
    expect(popover()).toBeNull();
    await click(3);
    await click(6, true);
    // A click inside a range selects that line: only the lone selected line clears.
    await click(4);
    expect(selected()).toBe('4');
    await click(2);
    await click(5, true);
    await escape();
    expect(selected()).toBeUndefined();
  });

  it('starts a drag from the only selected line instead of clearing it', async () => {
    const { click, down, moveTo, up, selected } = await setup();
    await click(3);
    await down(3);
    await moveTo(6);
    await up();
    expect(selected()).toBe('3-6');
  });

  it('never goes past the last line, and takes the keyboard so Esc reaches it', async () => {
    const { click, selected, scroll } = await setup();
    await click(40);
    expect(selected()).toBe('10');
    expect(document.activeElement).toBe(scroll());
  });

  it('is not the text selection of the browser: a press on a number starts none', async () => {
    const { el } = await setup();
    const event = new MouseEvent('mousedown', { clientY: 5, bubbles: true, cancelable: true });
    el.querySelector('.gutter')!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('shows a popover under the last selected line, above the first one near the bottom of the Pane', async () => {
    const { click, popover, viewport } = await setup();
    await viewport(400);
    await click(4);
    await click(5, true);
    expect(popover()?.classList.contains('above')).toBe(false);
    expect(popover()?.style.marginTop).toBe('94px');
    // 100 px of text on screen: under line 5 (which ends at 90 px) there is no room for the 32 px popover.
    await viewport(100);
    expect(popover()?.classList.contains('above')).toBe(true);
    expect(popover()?.style.marginTop).toBe('18px');
    // Above lines 1-5 it would be out of sight: it stays under them.
    await click(1, true);
    expect(popover()?.classList.contains('above')).toBe(false);
  });

  it('survives scrolling, the popover going back under the lines once there is room', async () => {
    const { click, selected, popover, viewport } = await setup();
    await viewport(100);
    await click(5);
    expect(popover()?.classList.contains('above')).toBe(true);
    await viewport(100, 60);
    expect(selected()).toBe('5');
    expect(popover()?.classList.contains('above')).toBe(false);
  });

  it('copies the selected lines exactly, without their numbers, from the popover', async () => {
    const { click, action, press, copied, selected } = await setup('const a = 1;\n\tif (a) {\n  }\nlast\n');
    await click(2);
    await click(3, true);
    await press(action('Copiar'));
    expect(copied).toEqual(['\tif (a) {\n  }']);
    // Copying keeps the lines marked.
    expect(selected()).toBe('2-3');
  });

  it('copies the path from the popover with the lines: `:n` for one, `:start-end` for a range', async () => {
    const { click, action, press, copied } = await setup();
    await click(7);
    await press(action('Copiar ruta'));
    await click(9, true);
    await press(action('Copiar ruta'));
    expect(copied).toEqual(['src/main.ts:7', 'src/main.ts:7-9']);
  });

  it('is kept outside the View, by Tab and file, so it can be set from elsewhere and is clamped to the file', async () => {
    const { selections, selected, click, settle } = await setup();
    selections.select(tab, 'src/main.ts', 4, 6);
    await settle();
    expect(selected()).toBe('4-6');
    selections.select(tab, 'src/main.ts', 8, 50);
    await settle();
    expect(selected()).toBe('8-10');
    selections.select(tab, 'src/main.ts', 30, 50);
    await settle();
    expect(selected()).toBeUndefined();
    await click(2);
    expect(selections.of(tab, 'src/main.ts')).toEqual({ anchor: 2, start: 2, end: 2 });
    expect(selections.of(tab, 'other.ts')).toBeUndefined();
  });

  it('has no line numbers to select in a file that is not text', async () => {
    const { host, el, settle } = await setup();
    host.path.set('logo.png');
    await settle();
    expect(el.querySelector('.gutter')).toBeNull();
    expect(el.querySelector('.selected')).toBeNull();
  });
});
