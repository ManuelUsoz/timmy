import type { Project } from '../../../shared/projects/projects.model';

/** Lowercase, with accents removed, so "Árbol" and "arbol" are the same text. */
export const normalizeText = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The projects whose name or path contains the query, ignoring case and accents. An empty query keeps all. */
export const filterProjects = (projects: ReadonlyArray<Project>, query: string): ReadonlyArray<Project> => {
  const needle = normalizeText(query.trim());
  if (needle === '') return projects;
  return projects.filter((project) => normalizeText(project.name).includes(needle) || normalizeText(project.cwd).includes(needle));
};

/** By name, ignoring case and accents, so the list does not reshuffle as the user opens projects. */
export const sortProjects = (projects: ReadonlyArray<Project>): ReadonlyArray<Project> =>
  [...projects].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.cwd.localeCompare(b.cwd));
