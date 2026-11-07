import { describe, expect, it } from 'vitest';
import type { Notification, TerminalStatus } from '../../../shared/notification/notification.model';
import { ProjectId, type Project } from '../../../shared/projects/projects.model';
import { TerminalId } from '../../../shared/terminal/terminal.model';
import { railView } from '../shell/panel-rail-view';
import type { TerminalEntry } from './terminal-entries';
import { projectTallies } from './workspace-sidebar-view';

const api = ProjectId.make('api');
const docs = ProjectId.make('docs');
const blog = ProjectId.make('blog');
const projects: ReadonlyArray<Project> = [
  { projectId: api, cwd: '/api', name: 'api-gateway', createdAt: 1, lastUsedAt: null },
  { projectId: docs, cwd: '/docs', name: 'docs-site', createdAt: 2, lastUsedAt: null },
  { projectId: blog, cwd: '/blog', name: 'blog', createdAt: 3, lastUsedAt: null },
];
const entry = (id: string, projectId: ProjectId, number: number): TerminalEntry => ({
  id: TerminalId.make(id),
  projectId,
  number,
  state: 'Live',
  activity: 'Idle',
});
const said = (id: string, type: TerminalStatus): Notification => ({ source: { _tag: 'Terminal', terminalId: TerminalId.make(id) }, type, seen: false, onScreen: false });

describe('projectTallies', () => {
  it('counts the Terminals of each Project and gives the most urgent status among them; a Project with none has no tally', () => {
    const view = railView(
      [entry('a', api, 1), entry('b', api, 2), entry('c', docs, 1), entry('d', api, 3)],
      [said('a', 'Working'), said('b', 'Error'), said('c', 'Done'), said('d', 'Waiting')],
      projects,
    );
    const tallies = projectTallies(view);
    expect(tallies.get(api)).toEqual({ count: 3, status: 'Waiting' });
    expect(tallies.get(docs)).toEqual({ count: 1, status: 'Done' });
    expect(tallies.get(blog)).toBeUndefined();
  });

  it('is Idle for a Project whose Terminals say nothing', () => {
    const view = railView([entry('a', docs, 1), entry('b', docs, 2)], [], projects);
    expect(projectTallies(view).get(docs)).toEqual({ count: 2, status: 'Idle' });
  });
});
