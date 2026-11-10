import { TestBed } from '@angular/core/testing';
import { ProjectId } from '../../../shared/projects/projects.model';
import type { TerminalId } from '../../../shared/terminal/terminal.model';
import { EffectRuntime } from '../../core/effect-runtime';
import { fakeRuntime, makeBackend, project, type FakeBackend } from '../workspace/projects-fakes';
import { TerminalsState } from '../workspace/terminals-state';
import { PanelTerminal } from './panel-terminal';

const timmy = project('timmy', { lastUsedAt: 300 });
const ascua = project('ascua', { lastUsedAt: 100 });

const setup = async (backend: FakeBackend = makeBackend({ projects: [timmy, ascua] })) => {
  await TestBed.configureTestingModule({
    imports: [PanelTerminal],
    providers: [{ provide: EffectRuntime, useValue: fakeRuntime(backend) }],
  }).compileComponents();
  const terminals = TestBed.inject(TerminalsState);
  const fixture = TestBed.createComponent(PanelTerminal);
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
  /** A Terminal in the state, as the Workspace left it. */
  const running = async (projectId: ProjectId) => {
    const entry = terminals.create(projectId);
    terminals.setState(entry.id, 'Live');
    await settle();
    return entry.id;
  };
  /** The lines of the rail, one per Terminal. */
  const rows = () => Array.from(el.querySelectorAll<HTMLElement>('app-panel-rail as-list-row'));
  const rowTitles = () => rows().map((row) => row.querySelector('.as-row__title')?.textContent?.trim());
  const groupLabels = () => Array.from(el.querySelectorAll('app-panel-rail as-list-group-label')).map((label) => `${label.querySelector('span')?.textContent}:${label.querySelector('.as-group__count')?.textContent}`);
  const heading = () => el.querySelector('app-terminal-screen h1')?.textContent?.trim();
  const buttonNamed = (name: string) => Array.from(el.querySelectorAll('button')).find((button) => button.textContent?.trim() === name);
  return { el, fixture, terminals, settle, running, rows, rowTitles, groupLabels, heading, buttonNamed };
};

describe('PanelTerminal', () => {
  describe('without Terminals', () => {
    it('offers to open one in the Project used last', async () => {
      const { el, buttonNamed } = await setup();
      expect(el.querySelector('app-workspace-hero h2')?.textContent).toContain('Aún no hay terminales');
      expect(el.querySelector('app-workspace-hero p')?.textContent).toContain('Se abre en timmy.');
      expect(buttonNamed('Nueva terminal')).toBeDefined();
      expect(el.querySelector('app-terminal-screen')).toBeNull();
      expect(el.querySelector('app-panel-rail as-list-row')).toBeNull();
    });

    it('sends the user to the Workspace when there is no Project to open one in', async () => {
      const { fixture, buttonNamed, settle } = await setup(makeBackend());
      let asked = 0;
      fixture.componentInstance.openWorkspace.subscribe(() => asked++);
      expect(buttonNamed('Nueva terminal')).toBeUndefined();
      expect(fixture.nativeElement.textContent).toContain('Añade un proyecto en el Workspace');
      buttonNamed('Abrir Workspace')!.click();
      await settle();
      expect(asked).toBe(1);
    });

    it('says so when the Terminal could not be opened, and stays on the empty state', async () => {
      const { el, buttonNamed, settle, terminals } = await setup();
      buttonNamed('Nueva terminal')!.click();
      await settle();
      expect(el.querySelector('[role=alert]')?.textContent).toContain('No se pudo abrir la terminal.');
      expect(terminals.entries()).toEqual([]);
      expect(buttonNamed('Nueva terminal')!.disabled).toBe(false);
    });
  });

  describe('with Terminals', () => {
    it('renders the current Terminal with the folder of its Project, and no empty state', async () => {
      const { el, running, heading } = await setup();
      await running(timmy.projectId);
      expect(el.querySelector('app-workspace-hero')).toBeNull();
      expect(heading()).toBe('shell 1');
      expect(el.querySelector('app-terminal-screen .cwd')?.textContent).toBe('/work/timmy');
    });

    it('lists every Terminal in the rail and lets the user switch between them', async () => {
      const { running, rows, rowTitles, heading, settle } = await setup();
      await running(timmy.projectId);
      await running(timmy.projectId);
      expect(rowTitles()).toEqual(['shell 1', 'shell 2']);
      expect(heading()).toBe('shell 2');
      expect(rows().map((row) => row.getAttribute('aria-selected'))).toEqual(['false', 'true']);
      rows()[0]!.click();
      await settle();
      expect(heading()).toBe('shell 1');
      expect(rows().map((row) => row.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    });

    it('shows the Terminal that is current in the Workspace', async () => {
      const { running, terminals, heading, settle } = await setup();
      const first: TerminalId = await running(timmy.projectId);
      await running(timmy.projectId);
      terminals.setCurrent(first);
      await settle();
      expect(heading()).toBe('shell 1');
    });

    it('groups the Terminals by Project, each group with its Project and how many Terminals it has', async () => {
      const { running, rowTitles, groupLabels } = await setup();
      await running(timmy.projectId);
      await running(ascua.projectId);
      await running(timmy.projectId);
      expect(groupLabels()).toEqual(['timmy:2', 'ascua:1']);
      expect(rowTitles()).toEqual(['shell 1', 'shell 2', 'shell 1']);
    });

    it('goes to the Pill from a double-click on the Mascot of the rail', async () => {
      const { el, fixture, settle } = await setup();
      let asked = 0;
      fixture.componentInstance.collapse.subscribe(() => asked++);
      el.querySelector('app-panel-rail .id')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await settle();
      expect(asked).toBe(1);
    });

    it('keeps a Terminal whose process ended, with its state, until it is closed', async () => {
      const { el, running, terminals, settle } = await setup();
      const id = await running(timmy.projectId);
      terminals.exited(id, 3);
      await settle();
      expect(el.querySelector('app-terminal-screen [role=alert]')?.textContent).toContain('3');
    });
  });
});
