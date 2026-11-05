import { describe, expect, it } from 'vitest';
import type { Notification, TerminalStatus } from '../../../shared/notification/notification.model';
import { ProjectId, type Project } from '../../../shared/projects/projects.model';
import { TerminalId } from '../../../shared/terminal/terminal.model';
import type { TerminalEntry } from '../workspace/terminal-entries';
import { railView, urgentTerminal } from './panel-rail-view';

const api = ProjectId.make('api');
const docs = ProjectId.make('docs');
const projects: ReadonlyArray<Project> = [
  { projectId: api, cwd: '/api', name: 'api-gateway', createdAt: 1, lastUsedAt: null },
  { projectId: docs, cwd: '/docs', name: 'docs-site', createdAt: 2, lastUsedAt: null },
];

const entry = (id: string, projectId: ProjectId, number: number, provider?: TerminalEntry['provider']): TerminalEntry => ({
  id: TerminalId.make(id),
  projectId,
  number,
  state: 'Live',
  activity: 'Idle',
  ...(provider === undefined ? {} : { provider }),
});
const said = (id: string, type: TerminalStatus): Notification => ({ source: { _tag: 'Terminal', terminalId: TerminalId.make(id) }, type });

describe('railView', () => {
  it('is empty with no Terminals', () => {
    expect(railView([], [], projects)).toEqual({ tally: [], groups: [] });
  });

  it('groups the Terminals by Project, in the order the Projects first appear, with the status of each Notification', () => {
    const view = railView(
      [entry('a', api, 1, 'ClaudeCode'), entry('b', docs, 1), entry('c', api, 2)],
      [said('a', 'Working'), said('c', 'Done')],
      projects,
    );
    expect(view.groups.map((group) => [group.name, group.needsYou, group.rows.map((row) => [row.number, row.status])])).toEqual([
      ['api-gateway', false, [[1, 'Working'], [2, 'Done']]],
      ['docs-site', false, [[1, 'Idle']]],
    ]);
    expect(view.groups[0]?.rows[0]).toMatchObject({ projectName: 'api-gateway', provider: 'ClaudeCode' });
  });

  it('puts the Terminals that need the user first, Waiting before Error, and takes them out of their Project', () => {
    const view = railView(
      [entry('a', api, 1), entry('b', api, 2), entry('c', docs, 1), entry('d', api, 3)],
      [said('a', 'Error'), said('b', 'Working'), said('c', 'Waiting'), said('d', 'Done')],
      projects,
    );
    expect(view.groups.map((group) => [group.name, group.needsYou, group.rows.map((row) => row.id)])).toEqual([
      ['', true, ['c', 'a']],
      ['api-gateway', false, ['b', 'd']],
    ]);
  });

  it('leaves out a Project whose Terminals all need the user, and keeps one that has no name yet', () => {
    const view = railView([entry('a', docs, 1)], [said('a', 'Waiting')], []);
    expect(view.groups.map((group) => group.needsYou)).toEqual([true]);
    expect(railView([entry('a', docs, 1)], [], []).groups[0]?.name).toBe('');
  });

  it('tallies the statuses that say something, most urgent first, from the Notifications', () => {
    const notifications = [said('a', 'Working'), said('b', 'Working'), said('c', 'Done'), said('d', 'Idle'), said('e', 'Waiting')];
    expect(railView([], notifications, projects).tally).toEqual([
      { status: 'Waiting', count: 1 },
      { status: 'Working', count: 2 },
      { status: 'Done', count: 1 },
    ]);
  });

  it('is only Idle Terminals: nothing to tally', () => {
    expect(railView([entry('a', api, 1)], [said('a', 'Idle')], projects).tally).toEqual([]);
  });
});

describe('urgentTerminal', () => {
  const view = railView([entry('a', api, 1), entry('b', api, 2), entry('c', api, 3)], [said('a', 'Done'), said('b', 'Working'), said('c', 'Working')], projects);

  it('is the first Terminal in the status the Mascot shows', () => {
    expect(urgentTerminal(view, 'Working')).toBe('b');
  });

  it('is nothing while the Mascot is Idle, or when no Terminal has that status', () => {
    expect(urgentTerminal(view, 'Idle')).toBeUndefined();
    expect(urgentTerminal(view, 'Error')).toBeUndefined();
  });
});
