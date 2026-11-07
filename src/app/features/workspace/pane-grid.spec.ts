import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ProjectId } from '../../../shared/projects/projects.model';
import { EffectRuntime } from '../../core/effect-runtime';
import { DIVIDER_STEP, PaneGrid, dragDivider, minAlong, zoneAt } from './pane-grid';
import { MIN_PANE, PaneId, addToStack, panesOf, singlePane, split, type LayoutNode } from './pane-layout';
import { PaneStack, VIEW_MIME } from './pane-stack';
import { fakeRuntime, makeBackend } from './projects-fakes';
import { TabId } from './tabs';
import { TabsState } from './tabs-state';
import { TerminalId } from './terminal-entries';
import { TerminalsState } from './terminals-state';
import { WorkspaceLayoutState } from './workspace-layout';

const t = (n: number) => TerminalId.make(`t${n}`);
const p = (n: number) => PaneId.make(`t${n}`);

describe('dragging a divider', () => {
  const three = split(split(singlePane(t(1)), p(1), 'right', t(2)), p(2), 'right', t(3)).root as LayoutNode & { kind: 'split' };

  it('needs the room of every Pane along the split, and the largest across it', () => {
    const nested = split(split(singlePane(t(1)), p(1), 'right', t(2)), p(2), 'down', t(3)).root;
    expect(minAlong(nested, 'right')).toBe(2 * MIN_PANE.width);
    expect(minAlong(nested, 'down')).toBe(2 * MIN_PANE.height);
  });

  it('moves only the two Panes beside it, by the distance dragged', () => {
    expect(dragDivider(three, [0.5, 0.25, 0.25], 1, 100, 2000)).toEqual([0.5, 0.3, 0.2]);
  });

  it('stops where a Pane would go below its minimum size, on either side', () => {
    // 2000 px: a Pane needs 240 px, 0.12 of it; the two on the divider share 0.5.
    expect(dragDivider(three, [0.5, 0.25, 0.25], 1, 900, 2000)).toEqual([0.5, 0.38, 0.12]);
    expect(dragDivider(three, [0.5, 0.25, 0.25], 1, -900, 2000)).toEqual([0.5, 0.12, 0.38]);
  });

  it('leaves a split too small for its Panes as it is', () => {
    expect(dragDivider(three, [0.5, 0.25, 0.25], 1, 50, 600)).toEqual([0.5, 0.25, 0.25]);
  });
});

describe('the zone of a Pane under a dragged View', () => {
  const rect = { left: 100, top: 50, width: 800, height: 400 };

  it('is an edge in the outer quarter of the Pane on that side, else the centre', () => {
    expect(zoneAt(rect, { x: 150, y: 250 })).toBe('left');
    expect(zoneAt(rect, { x: 850, y: 250 })).toBe('right');
    expect(zoneAt(rect, { x: 500, y: 100 })).toBe('up');
    expect(zoneAt(rect, { x: 500, y: 400 })).toBe('down');
    expect(zoneAt(rect, { x: 500, y: 250 })).toBe('center');
    // Just inside the quarter (200 px of 800 wide, 100 px of 400 tall) and just past it.
    expect(zoneAt(rect, { x: 299, y: 250 })).toBe('left');
    expect(zoneAt(rect, { x: 300, y: 250 })).toBe('center');
    expect(zoneAt(rect, { x: 500, y: 149 })).toBe('up');
    expect(zoneAt(rect, { x: 500, y: 150 })).toBe('center');
  });

  it('gives a corner to the nearer edge', () => {
    // 20 px from the left edge, 60 px from the top one.
    expect(zoneAt(rect, { x: 120, y: 110 })).toBe('left');
    // 80 px from the right edge, 10 px from the bottom one.
    expect(zoneAt(rect, { x: 820, y: 440 })).toBe('down');
  });

  it('is no zone outside the Pane', () => {
    expect(zoneAt(rect, { x: 99, y: 250 })).toBeUndefined();
    expect(zoneAt(rect, { x: 500, y: 451 })).toBeUndefined();
  });
});

describe('PaneGrid', () => {
  const projectId = ProjectId.make('p-timmy');
  const tabId = TabId.make('tab');

  /** A Tab of Terminals t1… with the layout `arrange` makes of them, in a grid of the given size. */
  const setup = async (count: number, arrange: (layout: ReturnType<typeof singlePane>) => ReturnType<typeof singlePane>, size = { width: 1600, height: 900 }) => {
    await TestBed.configureTestingModule({
      imports: [PaneGrid],
      providers: [{ provide: EffectRuntime, useValue: fakeRuntime(makeBackend()) }],
    }).compileComponents();
    const workspace = TestBed.inject(WorkspaceLayoutState);
    workspace.width.set(1400);
    const terminals = TestBed.inject(TerminalsState);
    const tabs = TestBed.inject(TabsState);
    const ids = Array.from({ length: count }, () => terminals.create(projectId, tabId).id);
    // The fakes number Terminals with random ids: name them t1… in the layout through their order.
    const rename = (layout: ReturnType<typeof singlePane>) => JSON.parse(JSON.stringify(layout).replace(/"t(\d)"/g, (_, n: string) => JSON.stringify(ids[Number(n) - 1])));
    const tab = () => tabs.tabsOf(projectId)[0];
    tabs.update(tab(), () => rename(arrange(singlePane(t(1)))));
    const fixture = TestBed.createComponent(PaneGrid);
    const el = fixture.nativeElement as HTMLElement;
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: size.width });
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: size.height });
    fixture.componentRef.setInput('tab', tab());
    fixture.componentRef.setInput('cwd', '/work/timmy');
    const settle = async () => {
      fixture.componentRef.setInput('tab', tab());
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    await settle();
    const stacks = () => fixture.debugElement.queryAll(By.directive(PaneStack)).map((debug) => debug.componentInstance as PaneStack);
    const layout = () => tabs.layoutOf(tab())!;
    return { el, settle, stacks, layout, ids, workspace };
  };

  it('lays the Panes out as the splits say, each by its share, with one focused', async () => {
    const { el, stacks, ids } = await setup(3, (layout) => split(split(layout, p(1), 'right', t(2)), p(2), 'down', t(3)));
    expect(stacks().map((stack) => stack.pane().views)).toEqual([[ids[0]], [ids[1]], [ids[2]]]);
    const outer = el.querySelector<HTMLElement>(':scope > .split')!;
    expect(outer.dataset['direction']).toBe('right');
    expect(outer.querySelector('.split')?.getAttribute('data-direction')).toBe('down');
    expect(Array.from(outer.querySelectorAll<HTMLElement>(':scope > .cell')).map((cell) => cell.style.flexGrow)).toEqual(['0.5', '0.5']);
    expect(stacks().map((stack) => stack.focused())).toEqual([false, false, true]);
    expect(el.querySelectorAll('.pane.focused')).toHaveLength(1);
    expect(Array.from(el.querySelectorAll('[role=separator]')).map((divider) => divider.getAttribute('aria-orientation'))).toEqual(['vertical', 'horizontal']);
  });

  it('offers a split only where the Pane has room for it', async () => {
    const { stacks } = await setup(2, (layout) => split(layout, p(1), 'right', t(2)), { width: 900, height: 900 });
    // Each Pane is 450 px wide: halved, 225 is below 240. 900 px tall halves to 450.
    expect(stacks().map((stack) => [stack.canSplitRight(), stack.canSplitDown()])).toEqual([
      [false, true],
      [false, true],
    ]);
  });

  it('focuses a Pane when the user clicks in it', async () => {
    const { el, settle, layout, ids } = await setup(2, (layout) => split(layout, p(1), 'right', t(2)));
    el.querySelector<HTMLElement>('app-pane-stack')!.dispatchEvent(new Event('pointerdown'));
    await settle();
    expect(layout().focused).toBe(ids[0]);
  });

  it('nudges a divider with the arrow keys along its axis', async () => {
    const { el, settle, layout } = await setup(2, (layout) => split(layout, p(1), 'right', t(2)));
    const outer = el.querySelector<HTMLElement>('.split')!;
    outer.getBoundingClientRect = () => ({ width: 1200, height: 900 }) as DOMRect;
    const divider = el.querySelector<HTMLElement>('[role=separator]')!;
    expect(divider.getAttribute('aria-valuenow')).toBe('50');
    divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await settle();
    expect(layout().root).toMatchObject({ sizes: [0.5 + DIVIDER_STEP / 1200, 0.5 - DIVIDER_STEP / 1200] });
    divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await settle();
    expect(layout().root).toMatchObject({ sizes: [0.5 + DIVIDER_STEP / 1200, 0.5 - DIVIDER_STEP / 1200] });
  });

  describe('dragging a View header to another Pane', () => {
    /** A drag event at a point (px), carrying the given types of data; jsdom has no DragEvent. */
    const dragEvent = (type: string, point = { x: 0, y: 0 }, types: ReadonlyArray<string> = [VIEW_MIME]) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      const data: Record<string, string> = {};
      const dataTransfer = { types, data, dropEffect: 'none', effectAllowed: 'all', setData: (kind: string, value: string) => (data[kind] = value) };
      Object.defineProperties(event, { clientX: { value: point.x }, clientY: { value: point.y }, dataTransfer: { value: dataTransfer } });
      return event as DragEvent & { dataTransfer: typeof dataTransfer };
    };
    const box = (left: number, top: number, width: number, height: number) => () => ({ left, top, width, height, x: left, y: top, right: left + width, bottom: top + height }) as DOMRect;

    /**
     * Two Panes side by side, 800 × 900 px each, the right one as `right` makes it; its headers 36 px tall from the top.
     * Starts dragging the header of the View at `index` of the given Pane (0 left, 1 right).
     */
    const dragging = async (right: (layout: ReturnType<typeof singlePane>) => ReturnType<typeof singlePane>, from: { pane: number; index: number }, count = 2) => {
      const context = await setup(count, (layout) => right(split(layout, p(1), 'right', t(2))));
      const { el, settle } = context;
      el.getBoundingClientRect = box(0, 0, 1600, 900);
      const paneEls = () => Array.from(el.querySelectorAll<HTMLElement>('.pane[data-pane]'));
      const place = () =>
        paneEls().forEach((pane, n) => {
          pane.getBoundingClientRect = box(n * 800, 0, 800, 900);
          pane.querySelectorAll<HTMLElement>('.view-header').forEach((header, row) => (header.getBoundingClientRect = box(n * 800, row * 36, 800, 36)));
        });
      place();
      const start = dragEvent('dragstart');
      paneEls()[from.pane].querySelectorAll<HTMLElement>('.view-header')[from.index].dispatchEvent(start);
      // The overlay comes a moment after the drag starts.
      await new Promise((resolve) => setTimeout(resolve));
      await settle();
      place();
      const overlay = () => el.querySelector<HTMLElement>('.drop-overlay');
      const over = async (point: { x: number; y: number }, types?: ReadonlyArray<string>) => {
        const event = dragEvent('dragover', point, types);
        overlay()!.dispatchEvent(event);
        await settle();
        return event;
      };
      const drop = async () => {
        overlay()!.dispatchEvent(dragEvent('drop'));
        await settle();
      };
      const preview = () => {
        const element = el.querySelector<HTMLElement>('.drop-preview');
        return element === null ? undefined : [element.style.left, element.style.top, element.style.width, element.style.height];
      };
      return { ...context, start, overlay, over, drop, preview, paneEls };
    };

    it('marks the drag as a View\'s and covers the grid with an overlay that previews the edge, then splits there', async () => {
      const { start, overlay, over, drop, preview, layout, ids } = await dragging((layout) => layout, { pane: 1, index: 0 });
      expect(start.dataTransfer.data[VIEW_MIME]).toBe(ids[1]);
      expect(overlay()).not.toBeNull();
      const event = await over({ x: 100, y: 450 });
      expect(event.defaultPrevented).toBe(true);
      expect(event.dataTransfer.dropEffect).toBe('move');
      expect(preview()).toEqual(['0px', '0px', '400px', '900px']);
      await drop();
      expect(overlay()).toBeNull();
      expect(panesOf(layout()).map((pane) => pane.views)).toEqual([[ids[1]], [ids[0]]]);
      expect(layout().focused).toBe(ids[1]);
    });

    it('previews the whole Pane in its centre, and adds the View to its Stack', async () => {
      const { over, drop, preview, layout, ids } = await dragging((layout) => layout, { pane: 1, index: 0 });
      await over({ x: 400, y: 450 });
      expect(preview()).toEqual(['0px', '0px', '800px', '900px']);
      await drop();
      expect(panesOf(layout())).toEqual([{ id: ids[0], views: [ids[0], ids[1]], expanded: ids[1] }]);
    });

    it('refuses a drop where it would do nothing: no preview, and the event is left undone for the no-drop cursor', async () => {
      const { over, drop, preview, layout } = await dragging((layout) => layout, { pane: 1, index: 0 });
      const before = layout();
      // Its own lone Pane, on an edge and in the centre.
      for (const point of [{ x: 1550, y: 450 }, { x: 1200, y: 450 }]) {
        const event = await over(point);
        expect(event.defaultPrevented).toBe(false);
        expect(event.dataTransfer.dropEffect).toBe('none');
        expect(preview()).toBeUndefined();
      }
      await drop();
      expect(layout()).toBe(before);
    });

    it('starts no drop for a drag from elsewhere, without the View type', async () => {
      const { over, preview } = await dragging((layout) => layout, { pane: 1, index: 0 });
      const event = await over({ x: 100, y: 450 }, ['Files']);
      expect(event.defaultPrevented).toBe(false);
      expect(preview()).toBeUndefined();
    });

    it('does not offer a full Stack\'s centre', async () => {
      const { over, preview } = await dragging((layout) => addToStack(addToStack(layout, p(2), t(3)), p(2), t(4)), { pane: 0, index: 0 }, 4);
      expect((await over({ x: 1200, y: 450 })).defaultPrevented).toBe(false);
      expect(preview()).toBeUndefined();
    });

    it('inserts the View at a place of another Stack by its headers, showing the drop line there', async () => {
      const { over, drop, preview, layout, ids, paneEls } = await dragging((layout) => addToStack(layout, p(2), t(3)), { pane: 0, index: 0 }, 3);
      // The upper half of the second header (36–72 px): before it.
      await over({ x: 1200, y: 40 });
      expect(preview()).toBeUndefined();
      expect(paneEls()[1].querySelector('.drop')?.nextElementSibling?.getAttribute('aria-label')).toBe('Terminal 3');
      await drop();
      expect(panesOf(layout())).toEqual([{ id: ids[1], views: [ids[1], ids[0], ids[2]], expanded: ids[0] }]);
    });

    it('reorders within its own Stack by the headers, as before', async () => {
      const { over, drop, layout, ids } = await dragging((layout) => addToStack(layout, p(2), t(3)), { pane: 1, index: 0 }, 3);
      await over({ x: 1200, y: 40 });
      await drop();
      expect(panesOf(layout())[1].views).toEqual([ids[2], ids[1]]);
    });

    it('changes nothing when the drag ends without a drop (Esc, or let go outside)', async () => {
      const { over, overlay, paneEls, settle, layout, preview } = await dragging((layout) => layout, { pane: 1, index: 0 });
      const before = layout();
      await over({ x: 100, y: 450 });
      paneEls()[1].querySelector('.view-header')!.dispatchEvent(dragEvent('dragend'));
      await settle();
      expect(overlay()).toBeNull();
      expect(preview()).toBeUndefined();
      expect(layout()).toBe(before);
    });

    it('lets a lone View\'s header be dragged only while every Pane shows, from lg up', async () => {
      const { el, settle, workspace } = await setup(2, (layout) => split(layout, p(1), 'right', t(2)));
      expect(el.querySelector('.view-header')?.getAttribute('draggable')).toBe('true');
      workspace.width.set(900);
      await settle();
      expect(el.querySelector('.view-header')?.getAttribute('draggable')).toBeNull();
    });

    it('offers no zones below lg', async () => {
      const { el, settle, workspace } = await setup(2, (layout) => addToStack(layout, p(1), t(2)));
      workspace.width.set(900);
      await settle();
      el.querySelector<HTMLElement>('.view-header')!.dispatchEvent(dragEvent('dragstart'));
      await new Promise((resolve) => setTimeout(resolve));
      await settle();
      expect(el.querySelector('.drop-overlay')).toBeNull();
    });
  });

  it('shows only the focused Pane below lg, and the whole layout again when the window widens', async () => {
    const { el, settle, stacks, layout, workspace, ids } = await setup(3, (layout) => addToStack(split(layout, p(1), 'right', t(2)), p(1), t(3)));
    const before = layout();
    workspace.width.set(900);
    await settle();
    expect(stacks().map((stack) => stack.pane().views)).toEqual([[ids[0], ids[2]]]);
    expect(el.querySelector('[role=separator]')).toBeNull();
    workspace.width.set(1400);
    await settle();
    expect(stacks()).toHaveLength(2);
    expect(panesOf(layout())).toEqual(panesOf(before));
  });
});
