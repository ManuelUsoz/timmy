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
  const chips = () => Array.from(el.querySelectorAll<HTMLButtonElement>('ui-chip-strip button'));
  const chipLabels = () => chips().map((chip) => chip.textContent?.trim());
  const heading = () => el.querySelector('app-terminal-screen h1')?.textContent?.trim();
  const buttonNamed = (name: string) => Array.from(el.querySelectorAll('button')).find((button) => button.textContent?.trim() === name);
  return { el, fixture, terminals, settle, running, chips, chipLabels, heading, buttonNamed };
};

describe('PanelTerminal', () => {
  describe('without Terminals', () => {
    it('offers to open one in the Project used last', async () => {
      const { el, buttonNamed } = await setup();
      expect(el.querySelector('app-workspace-hero h2')?.textContent).toContain('Aún no hay terminales');
      expect(el.querySelector('app-workspace-hero p')?.textContent).toContain('Se abre en timmy.');
      expect(buttonNamed('Nueva terminal')).toBeDefined();
      expect(el.querySelector('app-terminal-screen')).toBeNull();
      expect(el.querySelector('ui-chip-strip')).toBeNull();
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
      expect(heading()).toBe('Terminal 1');
      expect(el.querySelector('app-terminal-screen .cwd')?.textContent).toBe('/work/timmy');
    });

    it('lets the user switch between the Terminals there are', async () => {
      const { running, chips, chipLabels, heading, settle } = await setup();
      await running(timmy.projectId);
      await running(timmy.projectId);
      expect(chipLabels()).toEqual(['Terminal 1', 'Terminal 2']);
      expect(heading()).toBe('Terminal 2');
      expect(chips().map((chip) => chip.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
      chips()[0]!.click();
      await settle();
      expect(heading()).toBe('Terminal 1');
      expect(chips().map((chip) => chip.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    });

    it('shows the Terminal that is current in the Workspace', async () => {
      const { running, terminals, heading, settle } = await setup();
      const first: TerminalId = await running(timmy.projectId);
      await running(timmy.projectId);
      terminals.setCurrent(first);
      await settle();
      expect(heading()).toBe('Terminal 1');
    });

    it('names the Project on each chip when the Terminals belong to several', async () => {
      const { running, chipLabels } = await setup();
      await running(timmy.projectId);
      await running(ascua.projectId);
      expect(chipLabels()).toEqual(['timmy · Terminal 1', 'ascua · Terminal 1']);
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
