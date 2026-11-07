import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ProjectId } from '../../../shared/projects/projects.model';
import { EffectRuntime } from '../../core/effect-runtime';
import { DIVIDER_STEP, PaneGrid, dragDivider, minAlong } from './pane-grid';
import { MIN_PANE, PaneId, addToStack, panesOf, singlePane, split, type LayoutNode } from './pane-layout';
import { PaneStack } from './pane-stack';
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
