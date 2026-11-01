import { SessionId } from '../../../shared/chat/ids.model';
import { Project } from '../../../shared/projects/projects.model';
import { ProjectId } from '../../../shared/sessions/sessions.model';
import { entryPath, entryTarget } from './workspace-entry';

const project = (id: string, lastUsedAt: number | null): Project => ({
  projectId: ProjectId.make(id),
  name: id,
  cwd: `/${id}`,
  createdAt: 0,
  lastUsedAt,
});

const panel = (projectId: string, sessionId = 's1') => ({
  projectId: ProjectId.make(projectId),
  sessionId: SessionId.make(sessionId),
});

describe('entryTarget', () => {
  const projects = [project('a', 100), project('b', 300), project('c', null)];

  it('opens the project and the session of the live Panel session first', () => {
    expect(entryTarget(projects, panel('c'))).toEqual({ projectId: 'c', sessionId: 's1' });
  });

  it('falls back to the project used last when the Panel has no session', () => {
    expect(entryTarget(projects, undefined)).toEqual({ projectId: 'b' });
  });

  it('ignores a Panel session whose project is not in the list', () => {
    expect(entryTarget(projects, panel('gone'))).toEqual({ projectId: 'b' });
  });

  it('has nowhere to go when no project was ever used, or there are none', () => {
    expect(entryTarget([project('a', null)], undefined)).toBeUndefined();
    expect(entryTarget([], undefined)).toBeUndefined();
    expect(entryTarget([], panel('a'))).toBeUndefined();
  });
});

describe('entryPath', () => {
  it('is the project route, or the session route when there is a session', () => {
    expect(entryPath({ projectId: ProjectId.make('a') })).toEqual(['/projects', 'a']);
    expect(entryPath({ projectId: ProjectId.make('a'), sessionId: SessionId.make('s') })).toEqual([
      '/projects',
      'a',
      'sessions',
      's',
    ]);
  });
});
