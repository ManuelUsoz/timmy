import { Project } from '../../../shared/projects/projects.model';
import { ProjectId } from '../../../shared/projects/projects.model';
import { entryPath, entryTarget } from './workspace-entry';

const project = (id: string, lastUsedAt: number | null): Project => ({
  projectId: ProjectId.make(id),
  name: id,
  cwd: `/${id}`,
  createdAt: 0,
  lastUsedAt,
});

describe('entryTarget', () => {
  const projects = [project('a', 100), project('b', 300), project('c', null)];

  it('opens the project used last', () => {
    expect(entryTarget(projects)).toEqual({ projectId: 'b' });
  });

  it('has nowhere to go when no project was ever used, or there are none', () => {
    expect(entryTarget([project('a', null)])).toBeUndefined();
    expect(entryTarget([])).toBeUndefined();
  });
});

describe('entryPath', () => {
  it('is the project route', () => {
    expect(entryPath({ projectId: ProjectId.make('a') })).toEqual(['/projects', 'a']);
  });
});
