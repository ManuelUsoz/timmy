import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { EffectRuntime } from '../../core/effect-runtime';
import { I18n } from '../../core/i18n';
import { fakeRuntime, makeBackend, project, type FakeBackend } from './projects-fakes';
import { TerminalsState } from './terminals-state';
import { WorkspaceComponent } from './workspace';
import { WorkspaceLayoutState } from './workspace-layout';
import { provideWorkspaceRouter } from './workspace.routes';

interface Options {
  readonly backend?: FakeBackend;
}

const setup = async ({ backend = makeBackend() }: Options = {}) => {
  await TestBed.configureTestingModule({
    imports: [WorkspaceComponent],
    providers: [provideWorkspaceRouter(), { provide: EffectRuntime, useValue: fakeRuntime(backend) }],
  }).compileComponents();
  TestBed.inject(WorkspaceLayoutState).width.set(1400);
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
  const type = async (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  };
  /** The toasts on screen, as "Title: body". */
  const toastTexts = () =>
    Array.from(el.querySelectorAll('app-toast-host .toast')).map(
      (toast) => `${toast.querySelector('.as-note__title')?.textContent}: ${toast.querySelector('.as-note__body')?.textContent?.trim()}`,
    );
  return { el, router, settle, buttonNamed, click, rowTitles, projectRow, type, backend, fixture, toastTexts };
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

    it('tells the failure in a toast, and shows the list as unavailable, not empty, when the projects cannot be loaded', async () => {
      const { el, toastTexts } = await setup({ backend: makeBackend({ listFails: true }) });
      expect(toastTexts()).toEqual(['Error: No se pudieron cargar los proyectos. Vuelve a abrir Proyectos para intentarlo de nuevo.']);
      expect(el.querySelector('app-toast-host .toast')?.getAttribute('role')).toBe('alert');
      expect(el.querySelector('app-project-list [role=alert]')).toBeNull();
      expect(el.querySelector('app-project-list .note')?.textContent).toContain('Lista no disponible');
      expect(el.querySelector('app-project-list .note')?.textContent).not.toContain('Aquí aparecerán');
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

  describe('terminals of a project', () => {
    const textOf = (el: HTMLElement, selector: string) => Array.from(el.querySelectorAll(selector)).map((node) => node.textContent?.trim());
    const terminalGroup = (el: HTMLElement) => el.querySelector<HTMLElement>('app-project-content section[aria-label="Terminales"]')!;

    it('shows the Terminals and the files of the project, and nothing else', async () => {
      const { el } = await setup({ backend: makeBackend({ projects: [timmy] }) });
      const groups = Array.from(el.querySelectorAll('app-project-content section.group')).map((group) => group.getAttribute('aria-label'));
      expect(groups).toEqual(['Terminales', 'Archivos']);
    });

    it('says there are no terminals, with a "Nueva terminal" button in the list and in the main area, and no counter', async () => {
      const { el } = await setup({ backend: makeBackend({ projects: [timmy] }) });
      const group = terminalGroup(el);
      expect(group.querySelector('.empty-title')?.textContent).toBe('Aún no hay terminales');
      expect(group.querySelector('.empty small')?.textContent).toBe('Se abren en la carpeta del proyecto.');
      expect(group.querySelector('ui-tag')).toBeNull();
      expect(textOf(group, '.empty button')).toEqual(['Nueva terminal']);
      expect(el.querySelector('app-workspace-hero h2')?.textContent).toBe('Empieza en timmy');
      expect(textOf(el, 'app-workspace-hero button')).toEqual(['Nueva terminal']);
    });

    it('opens the first terminal from the main area', async () => {
      const { el, router, settle } = await setup({ backend: makeBackend({ projects: [timmy] }) });
      el.querySelector<HTMLButtonElement>('app-workspace-hero button')!.click();
      await settle();
      expect(router.url).toMatch(/^\/projects\/p-timmy\/terminals\/.+/);
      expect(textOf(terminalGroup(el), 'as-list-row .as-row__title')).toEqual(['Terminal 1']);
    });

    it('asks to pick a terminal when the project has some but none is open', async () => {
      const { el, router, click, settle } = await setup({ backend: makeBackend({ projects: [timmy] }) });
      await click('Nueva terminal');
      await router.navigate(['/projects', timmy.projectId]);
      await settle();
      expect(el.querySelector('app-workspace-hero h2')?.textContent).toBe('Elige una terminal');
    });

    it('creates a local terminal in the project and opens it at its own route, with a counter and its state', async () => {
      const { el, router, click, backend } = await setup({ backend: makeBackend({ projects: [timmy] }) });
      const calls = [...backend.calls];
      await click('Nueva terminal');
      expect(router.url).toMatch(/^\/projects\/p-timmy\/terminals\/.+/);
      const group = terminalGroup(el);
      expect(textOf(group, 'as-list-row .as-row__title')).toEqual(['Terminal 1']);
      expect(textOf(group, 'as-list-row ui-state')).toEqual(['Idle']);
      expect(group.querySelector('ui-tag')?.textContent?.trim()).toBe('1');
      expect(group.querySelector('as-list-row')?.getAttribute('aria-current')).toBe('true');
      expect(el.querySelector('app-terminal-screen h1')?.textContent).toBe('Terminal 1');
      // Nothing about terminals goes to main.
      expect(backend.calls).toEqual(calls);
    });

    it('adds a second terminal with the "+" of the group, and switches between them', async () => {
      const { el, router, click, settle } = await setup({ backend: makeBackend({ projects: [timmy] }) });
      await click('Nueva terminal');
      await click('Nueva terminal');
      const rows = () => Array.from(terminalGroup(el).querySelectorAll<HTMLElement>('as-list-row'));
      expect(rows().map((row) => row.querySelector('.as-row__title')?.textContent)).toEqual(['Terminal 1', 'Terminal 2']);
      expect(terminalGroup(el).querySelector('ui-tag')?.textContent?.trim()).toBe('2');
      const second = router.url;
      rows()[0].click();
      await settle();
      expect(router.url).not.toBe(second);
      expect(el.querySelector('app-terminal-screen h1')?.textContent).toBe('Terminal 1');
    });

    it('keeps the terminals of each project apart', async () => {
      const { el, click, projectRow, settle } = await setup({ backend: makeBackend({ projects: [timmy, ascua] }) });
      await click('Nueva terminal');
      projectRow('ascua')!.click();
      await settle();
      expect(terminalGroup(el).querySelector('.empty-title')?.textContent).toBe('Aún no hay terminales');
    });

    it('shows the terminal screen with its header, output and status bar', async () => {
      const { el, click } = await setup({ backend: makeBackend({ projects: [timmy] }) });
      await click('Nueva terminal');
      const screen = el.querySelector('app-terminal-screen')!;
      expect(screen.querySelector('header ui-state')?.textContent?.trim()).toBe('Idle');
      expect(screen.querySelector('.cwd')?.textContent).toBe('/work/timmy');
      expect(screen.querySelector('.output')?.textContent).toContain('…/timmy');
      expect(screen.querySelector('footer')?.textContent).toContain('Sin proceso activo');
      expect(screen.querySelector('[role=alert]')).toBeNull();
      expect(Array.from(screen.querySelectorAll('button')).every((button) => button.disabled)).toBe(true);
    });

    it('shows the failure screen, not a toast, when the terminal failed', async () => {
      const { el, click, settle, toastTexts } = await setup({ backend: makeBackend({ projects: [timmy] }) });
      await click('Nueva terminal');
      const terminals = TestBed.inject(TerminalsState);
      terminals.setState(terminals.entries()[0].id, 'Error');
      await settle();
      const screen = el.querySelector('app-terminal-screen')!;
      expect(screen.querySelector('header ui-state')?.textContent?.trim()).toBe('Error');
      expect(screen.querySelector('[role=alert]')?.textContent).toContain('El proceso terminó con código 1.');
      expect(screen.querySelector('[role=alert]')?.textContent).toContain('Revisa la salida de abajo o reinicia la terminal.');
      expect(screen.querySelector('.output')?.textContent).toContain('FAILED');
      expect(screen.querySelector('footer')?.textContent).toContain('Sin proceso activo');
      expect(textOf(terminalGroup(el), 'as-list-row .as-row__sub')).toEqual(['terminó con código 1']);
      expect(toastTexts()).toEqual([]);
    });

    it('shows a Live terminal with its output and a "Detener" button', async () => {
      const { el, click, settle } = await setup({ backend: makeBackend({ projects: [timmy] }) });
      await click('Nueva terminal');
      const terminals = TestBed.inject(TerminalsState);
      terminals.setState(terminals.entries()[0].id, 'Live');
      await settle();
      const screen = el.querySelector<HTMLElement>('app-terminal-screen')!;
      expect(screen.querySelector('header ui-state')?.textContent?.trim()).toBe('Live');
      expect(textOf(screen, 'header button')).toContain('Detener');
      expect(screen.querySelector('footer')?.textContent).toContain('120×34');
    });

    it('goes back to the project when the route names a terminal that is not there', async () => {
      const { router, settle } = await setup({ backend: makeBackend({ projects: [timmy] }) });
      await router.navigate(['/projects', timmy.projectId, 'terminals', 'gone']);
      await settle();
      expect(router.url).toBe('/projects/p-timmy');
    });

    it('shows the terminal in English', async () => {
      const { el, click, settle } = await setup({ backend: makeBackend({ projects: [timmy] }) });
      await click('Nueva terminal');
      TestBed.inject(I18n).setLanguage('en');
      await settle();
      const group = el.querySelector('app-project-content section[aria-label="Terminals"]')!;
      expect(group.querySelector('.as-row__title')?.textContent).toBe('Terminal 1');
      expect(el.querySelector('app-terminal-screen footer')?.textContent).toContain('No active process');
    });
  });

  describe('Groups of the project', () => {
    it('fold and unfold with a left click on their header', async () => {
      const { el, settle } = await setup({ backend: makeBackend({ projects: [timmy] }) });
      const group = (name: string) => el.querySelector(`app-project-content section[aria-label="${name}"]`)!;
      const toggle = (name: string) => group(name).querySelector<HTMLButtonElement>('.toggle')!;
      expect(toggle('Terminales').getAttribute('aria-expanded')).toBe('true');
      expect(group('Terminales').querySelector('.empty')).not.toBeNull();
      toggle('Terminales').click();
      await settle();
      expect(toggle('Terminales').getAttribute('aria-expanded')).toBe('false');
      expect(group('Terminales').querySelector('.empty')).toBeNull();
      expect(group('Archivos').querySelector('[role=tree]')).not.toBeNull();
      toggle('Terminales').click();
      await settle();
      expect(group('Terminales').querySelector('.empty')).not.toBeNull();
    });
  });

  describe('Projects column collapsed', () => {
    it('shows an avatar per project and a button for a new one, which open and add projects', async () => {
      const { el, settle, router } = await setup({ backend: makeBackend({ projects: [timmy, ascua] }) });
      TestBed.inject(WorkspaceLayoutState).width.set(1100);
      await settle();
      expect(el.querySelector('app-project-list input')).toBeNull();
      const rail = Array.from(el.querySelectorAll<HTMLButtonElement>('app-project-list .rail-project'));
      expect(rail.map((button) => button.getAttribute('aria-label'))).toEqual(['ascua', 'timmy']);
      expect(rail.map((button) => button.getAttribute('aria-current'))).toEqual([null, 'true']);
      expect(rail.map((button) => button.querySelector('.tile')?.textContent?.trim())).toEqual(['A', 'T']);
      rail[0].click();
      await settle();
      expect(router.url).toBe('/projects/p-ascua');
      el.querySelector<HTMLButtonElement>('app-project-list .rail-new')!.click();
      await settle();
      expect(el.querySelector('app-new-project-dialog')).not.toBeNull();
    });
  });

  describe('new project dialog', () => {
    const git = { folders: { '/work/timmy': 'main', '/work/new': 'main', '/work/plain': null } };

    it('picks a folder, shows its real branch and creates the project, which then opens', async () => {
      const backend = makeBackend({ projects: [timmy], ...git, picks: ['/work/new'] });
      const { el, router, click, rowTitles, settle } = await setup({ backend });
      await click('Nuevo proyecto');
      expect(el.querySelector('[role=dialog]')).not.toBeNull();
      expect(el.querySelector<HTMLButtonElement>('.actions .primary')!.disabled).toBe(true);
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
      expect(el.querySelector('app-toast-host .toast')).toBeNull();
      expect(el.querySelector<HTMLButtonElement>('.actions .primary')!.disabled).toBe(true);
    });

    it('offers to initialize git in a folder without it, and only then allows creating', async () => {
      const backend = makeBackend({ ...git, picks: ['/work/plain'] });
      const { el, click, rowTitles } = await setup({ backend });
      await click('Nuevo proyecto');
      await click('Examinar');
      expect(el.querySelector('.detect')?.textContent).toContain('no es un repositorio git');
      expect(el.querySelector<HTMLButtonElement>('.actions .primary')!.disabled).toBe(true);
      await click('Inicializar git');
      expect(backend.calls).toContain('Projects.initGit:/work/plain');
      expect(el.querySelector('.detect')?.textContent).toContain('Repositorio detectado en la rama master.');
      await click('Crear proyecto');
      expect(rowTitles('app-project-list')).toEqual(['plain']);
    });

    it('tells a git init that failed in a toast, not in the dialog', async () => {
      const backend = makeBackend({ ...git, picks: ['/work/plain'], initFails: true });
      const { el, click, toastTexts } = await setup({ backend });
      await click('Nuevo proyecto');
      await click('Examinar');
      await click('Inicializar git');
      expect(toastTexts()).toEqual(['Error: No se pudo inicializar git en la carpeta.']);
      expect(el.querySelector('.dialog .note')).toBeNull();
      expect(el.querySelector('[role=dialog]')).not.toBeNull();
    });

    it('says so when git is not installed, and keeps the folder without a repository', async () => {
      const backend = makeBackend({ ...git, picks: ['/work/plain'], gitMissing: true });
      const { el, click } = await setup({ backend });
      await click('Nuevo proyecto');
      await click('Examinar');
      await click('Inicializar git');
      expect(el.querySelector('.dialog .note')?.textContent).toContain('Git no está instalado');
      expect(el.querySelector('app-toast-host .toast')).toBeNull();
      expect(el.querySelector<HTMLButtonElement>('.actions .primary')!.disabled).toBe(true);
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
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await settle();
      expect(el.querySelector('[role=dialog]')).toBeNull();
    });
  });

  describe('removing a project', () => {
    it('takes it out of the list and goes to the next one', async () => {
      const backend = makeBackend({ projects: [timmy, ascua] });
      const { router, rowTitles, click } = await setup({ backend });
      await click('Quitar proyecto');
      expect(rowTitles('app-project-list')).toEqual(['ascua']);
      expect(router.url).toBe('/projects/p-ascua');
    });

    it('tells in a toast that the project could not be removed, and keeps it in the list', async () => {
      const { el, rowTitles, click, router, toastTexts } = await setup({ backend: makeBackend({ projects: [timmy], removeFails: true }) });
      await click('Quitar proyecto');
      expect(toastTexts()).toEqual(['Error: No se pudo quitar el proyecto. Inténtalo de nuevo.']);
      expect(rowTitles('app-project-list')).toEqual(['timmy']);
      expect(router.url).toBe('/projects/p-timmy');
      expect(el.querySelector('app-workspace-hero h2')?.textContent).not.toBe('Aún no tienes proyectos');
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
      // The column stays for Archivos, which says the folder cannot be read; no Terminals to use.
      expect(el.querySelector('app-project-content section[aria-label="Terminales"]')).toBeNull();
    });

    it('tells in a toast, once, when the folder cannot be checked, and the project stays usable', async () => {
      const { el, settle, toastTexts } = await setup({ backend: makeBackend({ projects: [timmy], checkFails: true }) });
      expect(toastTexts()).toEqual([
        'Error: No se pudo comprobar la carpeta del proyecto. Se volverá a comprobar al volver a la ventana.',
      ]);
      expect(el.querySelector('app-project-content')).not.toBeNull();
      window.dispatchEvent(new Event('focus'));
      await settle();
      expect(toastTexts()).toHaveLength(1);
    });

    it('checks again when the window regains focus: the folder disappears', async () => {
      const backend = makeBackend({ projects: [timmy] });
      const { el, settle } = await setup({ backend });
      expect(el.querySelector('app-project-content')).not.toBeNull();
      backend.missing.add(timmy.projectId);
      window.dispatchEvent(new Event('focus'));
      await settle();
      expect(el.querySelector('app-workspace-hero h2')?.textContent).toBe('No encontramos la carpeta');
      expect(el.querySelector('app-project-content section[aria-label="Terminales"]')).toBeNull();
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

  describe('Archivos and pending actions', () => {
    const filesGroup = (el: HTMLElement) => el.querySelector<HTMLElement>('app-project-content section[aria-label="Archivos"]')!;
    const treeLabels = (el: HTMLElement) =>
      Array.from(filesGroup(el).querySelectorAll('[role=treeitem] .as-treeitem__label')).map((node) => node.textContent);

    it('shows the Archivos group with the static tree, its modified mark and a dimmed node_modules', async () => {
      const { el } = await setup({ backend: makeBackend({ projects: [timmy] }) });
      const group = filesGroup(el);
      expect(group.querySelector('.label')?.textContent).toBe('Archivos');
      expect(group.querySelector('[role=tree]')?.getAttribute('aria-label')).toBe('Archivos del proyecto');
      expect(treeLabels(el)).toEqual(['src', 'app', 'core', 'features', 'electron', 'node_modules', 'CLAUDE.md', 'package.json']);
      expect(group.querySelector('.as-treeitem__flag')?.getAttribute('aria-label')).toBe('Modificado');
      const dimmed = Array.from(group.querySelectorAll('[data-dimmed] .as-treeitem__label')).map((node) => node.textContent);
      expect(dimmed).toEqual(['node_modules']);
    });

    it('expands and collapses folders as pure UI, with no call to main', async () => {
      const backend = makeBackend({ projects: [timmy] });
      const { el, settle } = await setup({ backend });
      const calls = [...backend.calls];
      const folder = (name: string) =>
        Array.from(filesGroup(el).querySelectorAll<HTMLElement>('[role=treeitem]')).find((i) => i.querySelector('.as-treeitem__label')?.textContent === name)!;
      folder('electron').click();
      await settle();
      expect(treeLabels(el)).toContain('main.ts');
      folder('src').click();
      await settle();
      expect(treeLabels(el)).toEqual(['src', 'electron', 'main.ts', 'node_modules', 'CLAUDE.md', 'package.json']);
      expect(backend.calls).toEqual(calls);
    });

    it('collapses and expands the whole group with its header button', async () => {
      const { el, click } = await setup({ backend: makeBackend({ projects: [timmy] }) });
      await click('Contraer Archivos');
      expect(filesGroup(el).querySelector('[role=tree]')).toBeNull();
      expect(filesGroup(el).querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
      await click('Expandir Archivos');
      expect(filesGroup(el).querySelector('[role=tree]')).not.toBeNull();
    });

    it('has the pending buttons enabled to the keyboard, named, and with no effect when pressed', async () => {
      const backend = makeBackend({ projects: [timmy] });
      const { el, router, settle, toastTexts } = await setup({ backend });
      const calls = [...backend.calls];
      const url = router.url;
      const pending = ['Abrir en el explorador', 'Buscar archivo'].map((name) => {
        const button = Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.getAttribute('aria-label') === name);
        expect(button, name).toBeDefined();
        expect(button!.disabled, name).toBe(false);
        expect(button!.getAttribute('aria-disabled'), name).toBe('true');
        expect(button!.tabIndex, name).toBe(0);
        return button!;
      });
      const html = el.innerHTML;
      pending.forEach((button) => button.click());
      await settle();
      expect(el.innerHTML).toBe(html);
      expect(router.url).toBe(url);
      expect(backend.calls).toEqual(calls);
      expect(toastTexts()).toEqual([]);
    });

    it('says the folder cannot be read in Archivos when the folder is missing, without tree or search', async () => {
      const { el } = await setup({ backend: makeBackend({ projects: [timmy], missing: new Set([timmy.projectId]) }) });
      const group = filesGroup(el);
      expect(group.querySelector('.empty-title')?.textContent).toBe('No se puede leer la carpeta');
      expect(group.querySelector('.empty small')?.textContent).toBe('Los archivos volverán cuando la carpeta esté disponible.');
      expect(group.querySelector('[role=tree]')).toBeNull();
      expect(group.querySelector('[aria-label="Buscar archivo"]')).toBeNull();
    });
  });

  describe('language', () => {
    it('shows the new strings in English', async () => {
      const { el, settle } = await setup({ backend: makeBackend({ projects: [timmy] }) });
      TestBed.inject(I18n).setLanguage('en');
      await settle();
      expect(el.querySelector('app-project-content .empty-title')?.textContent).toBe('No terminals yet');
      expect(el.querySelector('app-project-list input')?.getAttribute('placeholder')).toBe('Search projects');
    });

    it('shows a toast already on screen in the new language', async () => {
      const { settle, toastTexts } = await setup({ backend: makeBackend({ listFails: true }) });
      TestBed.inject(I18n).setLanguage('en');
      await settle();
      expect(toastTexts()).toEqual(['Error: The projects could not be loaded. Open Projects again to retry.']);
    });
  });
});
