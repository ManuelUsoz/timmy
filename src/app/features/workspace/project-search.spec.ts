import { Project } from '../../../shared/projects/projects.model';
import { ProjectId } from '../../../shared/sessions/sessions.model';
import { filterProjects, sortProjects } from './project-search';

const project = (name: string, cwd: string): Project => ({
  projectId: ProjectId.make(name),
  name,
  cwd,
  createdAt: 0,
  lastUsedAt: null,
});

const timmy = project('timmy', String.raw`C:\Users\miuso\workspace\nxy\timmy`);
const pagos = project('API de pagos', String.raw`C:\Users\miuso\nxy\nxy-api`);
const arbol = project('Árbol', '/home/ana/proyectos/bosque');
const all = [timmy, pagos, arbol];
const names = (projects: ReadonlyArray<Project>) => projects.map((p) => p.name);

describe('filterProjects', () => {
  it('keeps everything for an empty or blank query', () => {
    expect(filterProjects(all, '')).toEqual(all);
    expect(filterProjects(all, '   ')).toEqual(all);
  });

  it('matches the name, ignoring case', () => {
    expect(names(filterProjects(all, 'TIMMY'))).toEqual(['timmy']);
    expect(names(filterProjects(all, 'de pag'))).toEqual(['API de pagos']);
  });

  it('matches the path too', () => {
    expect(names(filterProjects(all, 'nxy-api'))).toEqual(['API de pagos']);
    expect(names(filterProjects(all, 'bosque'))).toEqual(['Árbol']);
  });

  it('ignores accents in the query and in the text', () => {
    expect(names(filterProjects(all, 'arbol'))).toEqual(['Árbol']);
    expect(names(filterProjects(all, 'ÁRBOL'))).toEqual(['Árbol']);
    expect(names(filterProjects([project('Café', '/c')], 'cafe'))).toEqual(['Café']);
  });

  it('finds nothing when nothing matches', () => {
    expect(filterProjects(all, 'zzz')).toEqual([]);
  });
});

describe('sortProjects', () => {
  it('orders by name without regard to case or accents, and does not touch its input', () => {
    const input = [project('zeta', '/z'), arbol, project('Beta', '/b'), project('alfa', '/a')];
    expect(names(sortProjects(input))).toEqual(['alfa', 'Árbol', 'Beta', 'zeta']);
    expect(names(input)).toEqual(['zeta', 'Árbol', 'Beta', 'alfa']);
  });
});
