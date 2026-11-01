import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { SessionId } from '../../../shared/chat/ids.model';
import type { PermissionRequest } from '../../../shared/chat/permission.model';
import { EffectRuntime } from '../../core/effect-runtime';
import { I18n } from '../../core/i18n';
import { ChatController } from '../chat/chat-controller';
import { fakeRuntime, makeBackend, project, session, type FakeBackend } from './projects-fakes';
import { WorkspaceComponent } from './workspace';
import { WorkspaceLayoutState } from './workspace-layout';
import { provideWorkspaceRouter } from './workspace.routes';

interface Options {
  readonly backend?: FakeBackend;
  /** Runs before the Workspace is created, to put the Panel's chat in some state. */
  readonly panel?: (chat: ChatController) => void;
}

const setup = async ({ backend = makeBackend(), panel }: Options = {}) => {
  await TestBed.configureTestingModule({
    imports: [WorkspaceComponent],
    providers: [provideWorkspaceRouter(), { provide: EffectRuntime, useValue: fakeRuntime(backend) }],
  }).compileComponents();
  TestBed.inject(WorkspaceLayoutState).width.set(1400);
  const chat = TestBed.inject(ChatController);
  panel?.(chat);
  const fixture = TestBed.createComponent(WorkspaceComponent);
  const el = fixture.nativeElement as HTMLElement;
  const router = TestBed.inject(Router);
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r));
      fixture.detectChanges();
    }
  };
  fixture.detectChanges();
  await settle();
  const buttons = () => Array.from(el.querySelectorAll<HTMLButtonElement>('button'));
  const buttonNamed = (text: string) => buttons().find((b) => (b.textContent ?? '').trim() === text || b.getAttribute('aria-label') === text);
  const click = async (text: string) => {
    const button = buttonNamed(text);
    if (button === undefined) throw new Error(`No button "${text}"`);
    button.click();
    await settle();
  };
  const rows = (selector: string) => Array.from(el.querySelectorAll<HTMLElement>(`${selector} as-list-row`));
  const rowTitles = (selector: string) => rows(selector).map((row) => row.querySelector('.as-row__title')?.textContent?.trim());
  const projectRow = (name: string) => rows('app-project-list').find((row) => row.querySelector('.as-row__title')?.textContent?.trim() === name);
  const sessionRow = (title: string) => rows('app-project-content').find((row) => row.querySelector('.as-row__title')?.textContent?.trim() === title);
  const type = async (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  };
  return { el, router, chat, settle, buttonNamed, click, rowTitles, projectRow, sessionRow, type, backend, fixture };
};

const timmy = project('timmy', { lastUsedAt: 300 });
const ascua = project('ascua', { lastUsedAt: 100 });

describe('Projects screen', () => {
  describe('project list', () => {
    it('lists the projects by name, with their path', async () => {
      const { el, rowTitles } = await setup({ backend: makeBackend({ projects: [timmy, project('Árbol'), ascua] }) });
      expect(rowTitles('app-project-list')).toEqual(['Árbol', 'ascua', 'timmy']);
      expect(el.querySelector('app-project-list .as-row__sub')?.textContent).toContain('/work/');
    });

    it('filters with the search box by name and by path, ignoring case and accents', async () => {
      const { el, rowTitles, type } = await setup({
        backend: makeBackend({ projects: [timmy, project('Árbol', { cwd: '/home/ana/bosque' }), ascua] }),
      });
      const search = el.querySelector<HTMLInputElement>('app-project-list input[type=search]')!;
      await type(search, 'ARBOL');
      expect(rowTitles('app-project-list')).toEqual(['Árbol']);
      await type(search, 'bosque');
      expect(rowTitles('app-project-list')).toEqual(['Árbol']);
      await type(search, 'work/asc');
      expect(rowTitles('app-project-list')).toEqual(['ascua']);
      await type(search, 'zzz');
      expect(rowTitles('app-project-list')).toEqual([]);
      expect(el.querySelector('app-project-list .note')?.textContent).toContain('Ningún proyecto coincide');
      await type(search, '');
      expect(rowTitles('app-project-list')).toHaveLength(3);
    });

    it('says there are no projects, in the list and in the main area', async () => {
      const { el, buttonNamed } = await setup();
      expect(el.querySelector('app-project-list .note')?.textContent).toContain('Aquí aparecerán las carpetas');
      expect(el.querySelector('app-workspace-hero h2')?.textContent).toBe('Aún no tienes proyectos');
      expect(buttonNamed('Nuevo proyecto')).toBeDefined();
    });

    it('shows the failure, not an empty list, when the projects cannot be loaded', async () => {
      const { el } = await setup({ backend: makeBackend({ listFails: true }) });
      expect(el.querySelector('app-project-list [role=alert]')?.textContent).toContain('No se pudieron cargar los proyectos');
      expect(el.querySelector('app-workspace-hero')).toBeNull();
    });
  });

  describe('entering the Workspace', () => {
    it('opens the project used last', async () => {
      const { router, el } = await setup({ backend: makeBackend({ projects: [ascua, timmy] }) });
      expect(router.url).toBe('/projects/p-timmy');
      expect(el.querySelector('app-project-content h2')?.textContent).toBe('timmy');
      expect(el.querySelector('app-project-list as-list-row[aria-current=true] .as-row__title')?.textContent?.trim()).toBe('timmy');
    });

    it('opens the project and the session of the live Panel session first', async () => {
      const { router, el } = await setup({
        backend: makeBackend({ projects: [ascua, timmy], sessions: [session('ascua', 's9', 'En el panel')] }),
        panel: (chat) => {
          chat.sessions.set([session('ascua', 's9', 'En el panel')]);
          chat.selectedSessionId.set(SessionId.make('s9'));
        },
      });
      expect(router.url).toBe('/projects/p-ascua/sessions/s9');
      expect(el.querySelector('app-project-content h2')?.textContent).toBe('ascua');
      expect(el.querySelector('app-chat-view')).not.toBeNull();
    });

    it('does not follow a Panel session whose project is not in the list', async () => {
      const { router } = await setup({
        backend: makeBackend({ projects: [ascua, timmy] }),
        panel: (chat) => {
          chat.sessions.set([session('elsewhere', 's9', 'x')]);
          chat.selectedSessionId.set(SessionId.make('s9'));
        },
      });
      expect(router.url).toBe('/projects/p-timmy');
    });

    it('stays on the list with nothing open when no project was ever used', async () => {
      const { router, el } = await setup({ backend: makeBackend({ projects: [project('timmy')] }) });
      expect(router.url).toBe('/projects');
      expect(el.querySelector('app-project-content')).toBeNull();
      expect(el.querySelector('app-workspace-hero h2')?.textContent).toBe('Elige un proyecto');
    });

    it('remembers the project the user opens as the last used', async () => {
      const backend = makeBackend({ projects: [project('timmy'), project('ascua')] });
      const first = await setup({ backend });
      first.projectRow('ascua')!.click();
      await first.settle();
      expect(first.router.url).toBe('/projects/p-ascua');
      expect(backend.calls).toContain('Projects.markUsed:p-ascua');
      TestBed.resetTestingModule();
      const second = await setup({ backend });
      expect(second.router.url).toBe('/projects/p-ascua');
    });
  });

  describe('sessions of a project', () => {
    const sessions = [session('timmy', 's1', 'Refactor del handshake', 20), session('timmy', 's2', 'Migrar a Effect', 10), session('ascua', 's3', 'Otro proyecto')];
    const withSessions = () => makeBackend({ projects: [timmy], sessions });

    it('lists only the sessions of the project, all Idle when none is open', async () => {
      const { el, rowTitles } = await setup({ backend: withSessions() });
      expect(rowTitles('app-project-content')).toEqual(['Refactor del handshake', 'Migrar a Effect']);
      const states = Array.from(el.querySelectorAll('app-project-content ui-state')).map((s) => s.textContent?.trim());
      expect(states).toEqual(['Idle', 'Idle']);
      expect(el.querySelector('app-workspace-hero h2')?.textContent).toBe('Elige una sesión');
    });

    it('opens a session in the chat at its own route and loads the conversation', async () => {
      const { router, el, sessionRow, settle } = await setup({ backend: withSessions() });
      sessionRow('Migrar a Effect')!.click();
      await settle();
      expect(router.url).toBe('/projects/p-timmy/sessions/s2');
      const chat = el.querySelector('app-chat-view')!;
      expect(chat.textContent).toContain('question s2');
      expect(chat.textContent).toContain('answer s2');
      expect(chat.textContent).toContain('Migrar a Effect');
      expect(sessionRow('Migrar a Effect')!.getAttribute('aria-current')).toBe('true');
    });

    it('shows the real state of the open session and Idle for the rest', async () => {
      const { el, chat, sessionRow, settle } = await setup({ backend: withSessions() });
      sessionRow('Refactor del handshake')!.click();
      await settle();
      const stateOf = (title: string) => sessionRow(title)!.querySelector('ui-state')?.textContent?.trim();
      expect(stateOf('Refactor del handshake')).toBe('Idle');

      chat.chat.set({ ...chat.chat(), running: true });
      await settle();
      expect(stateOf('Refactor del handshake')).toBe('Live');
      expect(stateOf('Migrar a Effect')).toBe('Idle');
      expect(el.querySelector('app-project-list ui-state')?.textContent?.trim()).toBe('1');

      chat.chat.set({ ...chat.chat(), permission: { id: 'p1', toolCall: { name: 'Bash', title: 'ls' }, options: [] } as unknown as PermissionRequest });
      await settle();
      expect(stateOf('Refactor del handshake')).toBe('Asks');
    });

    it('says there are no sessions, with a "Nueva sesión" button that does nothing yet', async () => {
      const { el, buttonNamed, backend, settle } = await setup({ backend: makeBackend({ projects: [timmy] }) });
      expect(el.querySelector('app-project-content .empty-title')?.textContent).toBe('Aún no hay sesiones');
      expect(el.querySelector('app-workspace-hero h2')?.textContent).toBe('Empieza en timmy');
      const before = backend.calls.length;
      buttonNamed('Nueva sesión')!.click();
      await settle();
      expect(backend.calls.length).toBe(before);
    });

    it('goes back to the project when the route names a session it does not have', async () => {
      const { router, settle } = await setup({ backend: withSessions() });
      await router.navigate(['/projects', 'p-timmy', 'sessions', 'nope']);
      await settle();
      expect(router.url).toBe('/projects/p-timmy');
    });

    it('tells the user a running turn blocks opening another session', async () => {
      const { el, chat, sessionRow, settle } = await setup({ backend: withSessions() });
      chat.chat.set({ ...chat.chat(), running: true });
      sessionRow('Migrar a Effect')!.click();
      await settle();
      expect(el.querySelector('app-workspace-hero p')?.textContent).toContain('Hay un turno en marcha');
      expect(el.querySelector('app-chat-view')).toBeNull();
    });
  });

  describe('new project dialog', () => {
    const git = { folders: { '/work/timmy': 'main', '/work/new': 'main', '/work/plain': null } };

    it('picks a folder, shows its real branch and creates the project, which then opens', async () => {
      const backend = makeBackend({ projects: [timmy], ...git, picks: ['/work/new'] });
      const { el, router, click, rowTitles, settle } = await setup({ backend });
      await click('Nuevo proyecto');
      expect(el.querySelector('[role=dialog]')).not.toBeNull();
      expect(el.querySelector<HTMLButtonElement>('.footer-button:last-child')!.disabled).toBe(true);
      await click('Examinar');
      expect(el.querySelector<HTMLInputElement>('#new-project-folder')!.value).toBe('/work/new');
      expect(el.querySelector('.detect')?.textContent).toContain('Repositorio detectado en la rama main.');
      await click('Crear proyecto');
      await settle();
      expect(el.querySelector('[role=dialog]')).toBeNull();
      expect(rowTitles('app-project-list')).toEqual(['new', 'timmy']);
      expect(router.url).toBe('/projects/p-new');
    });

    it('uses the name the user typed', async () => {
      const backend = makeBackend({ ...git, picks: ['/work/new'] });
      const { el, click, type, rowTitles } = await setup({ backend });
      await click('Nuevo proyecto');
      await click('Examinar');
      await type(el.querySelector<HTMLInputElement>('.name input')!, 'Mi proyecto');
      await click('Crear proyecto');
      expect(rowTitles('app-project-list')).toEqual(['Mi proyecto']);
    });

    it('rejects a folder that is already a project, with the error of the design, and cannot create', async () => {
      const backend = makeBackend({ projects: [timmy], ...git, picks: ['/work/timmy'] });
      const { el, click } = await setup({ backend });
      await click('Nuevo proyecto');
      await click('Examinar');
      expect(el.querySelector('.dialog .note')?.textContent).toContain('Esa carpeta ya está en tu lista como timmy');
      expect(el.querySelector('.dialog .help.bad')?.textContent).toBe('Esta carpeta ya es un proyecto.');
      expect(el.querySelector<HTMLButtonElement>('.footer-button:last-child')!.disabled).toBe(true);
    });

    it('offers to initialize git in a folder without it, and only then allows creating', async () => {
      const backend = makeBackend({ ...git, picks: ['/work/plain'] });
      const { el, click, rowTitles } = await setup({ backend });
      await click('Nuevo proyecto');
      await click('Examinar');
      expect(el.querySelector('.detect')?.textContent).toContain('no es un repositorio git');
      expect(el.querySelector<HTMLButtonElement>('.footer-button:last-child')!.disabled).toBe(true);
      await click('Inicializar git');
      expect(backend.calls).toContain('Projects.initGit:/work/plain');
      expect(el.querySelector('.detect')?.textContent).toContain('Repositorio detectado en la rama master.');
      await click('Crear proyecto');
      expect(rowTitles('app-project-list')).toEqual(['plain']);
    });

    it('says so when git is not installed, and keeps the folder without a repository', async () => {
      const backend = makeBackend({ ...git, picks: ['/work/plain'], gitMissing: true });
      const { el, click } = await setup({ backend });
      await click('Nuevo proyecto');
      await click('Examinar');
      await click('Inicializar git');
      expect(el.querySelector('.dialog .note')?.textContent).toContain('Git no está instalado');
      expect(el.querySelector<HTMLButtonElement>('.footer-button:last-child')!.disabled).toBe(true);
    });

    it('keeps the dialog as it was when the user cancels the folder picker, and closes with Cancelar', async () => {
      const { el, click } = await setup({ backend: makeBackend({ ...git }) });
      await click('Nuevo proyecto');
      await click('Examinar');
      expect(el.querySelector<HTMLInputElement>('#new-project-folder')!.value).toBe('');
      await click('Cancelar');
      expect(el.querySelector('[role=dialog]')).toBeNull();
    });

    it('closes with Escape', async () => {
      const { el, click, settle } = await setup();
      await click('Nuevo proyecto');
      el.querySelector('app-new-project-dialog')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await settle();
      expect(el.querySelector('[role=dialog]')).toBeNull();
    });
  });

  describe('removing a project', () => {
    it('takes it out of the list and goes to the next one, leaving the sessions alone', async () => {
      const backend = makeBackend({ projects: [timmy, ascua], sessions: [session('timmy', 's1', 'Keep me')] });
      const { router, rowTitles, click } = await setup({ backend });
      await click('Quitar proyecto');
      expect(rowTitles('app-project-list')).toEqual(['ascua']);
      expect(router.url).toBe('/projects/p-ascua');
      expect(backend.sessions).toHaveLength(1);
    });

    it('shows the empty state after the last project is removed', async () => {
      const { el, click } = await setup({ backend: makeBackend({ projects: [timmy] }) });
      await click('Quitar proyecto');
      expect(el.querySelector('app-workspace-hero h2')?.textContent).toBe('Aún no tienes proyectos');
    });
  });

  describe('folder that is not there', () => {
    const missing = () => makeBackend({ projects: [timmy], missing: new Set([timmy.projectId]) });

    it('shows the error state when the project is opened, with only "Quitar proyecto"', async () => {
      const { el, buttonNamed } = await setup({ backend: missing() });
      expect(el.querySelector('app-workspace-hero h2')?.textContent).toBe('No encontramos la carpeta');
      expect(el.querySelector('app-workspace-hero code')?.textContent).toBe('/work/timmy');
      const hero = Array.from(el.querySelectorAll('app-workspace-hero button')).map((b) => b.textContent?.trim());
      expect(hero).toEqual(['Quitar proyecto']);
      expect(buttonNamed('Localizar carpeta')).toBeUndefined();
      expect(buttonNamed('Reintentar')).toBeUndefined();
      expect(el.querySelector('app-project-content')).toBeNull();
    });

    it('checks again when the window regains focus: the folder disappears', async () => {
      const backend = makeBackend({ projects: [timmy] });
      const { el, settle } = await setup({ backend });
      expect(el.querySelector('app-project-content')).not.toBeNull();
      backend.missing.add(timmy.projectId);
      window.dispatchEvent(new Event('focus'));
      await settle();
      expect(el.querySelector('app-workspace-hero h2')?.textContent).toBe('No encontramos la carpeta');
      expect(el.querySelector('app-project-content')).toBeNull();
    });

    it('checks again when the window regains focus: the folder comes back', async () => {
      const backend = missing();
      const { el, settle } = await setup({ backend });
      backend.missing.clear();
      window.dispatchEvent(new Event('focus'));
      await settle();
      expect(el.querySelector('app-project-content')).not.toBeNull();
      expect(el.querySelector('app-workspace-hero h2')?.textContent).not.toBe('No encontramos la carpeta');
    });

    it('removes the project from the error state', async () => {
      const { el, click, rowTitles } = await setup({ backend: missing() });
      await click('Quitar proyecto');
      expect(rowTitles('app-project-list')).toEqual([]);
      expect(el.querySelector('app-workspace-hero h2')?.textContent).toBe('Aún no tienes proyectos');
    });
  });

  describe('language', () => {
    it('shows the new strings in English', async () => {
      const { el, settle } = await setup({ backend: makeBackend({ projects: [timmy] }) });
      TestBed.inject(I18n).setLanguage('en');
      await settle();
      expect(el.querySelector('app-project-content .empty-title')?.textContent).toBe('No sessions yet');
      expect(el.querySelector('app-project-list input')?.getAttribute('placeholder')).toBe('Search projects');
    });
  });
});
