import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { DesktopApi } from '../../src/app/core/desktop-api';
import {
  layerFilesUnused,
  layerProjectsUnused,
  layerSettingsUnused,
  layerWindowUnused,
  makeDesktopTestLayer,
} from '../../src/app/core/desktop-layers';
import { AppInfoRpcs } from '../../src/shared/app-info/app-info.rpc';
import type { ProjectId } from '../../src/shared/projects/projects.model';
import type { Provider } from '../../src/shared/settings/settings.model';
import { TerminalId } from '../../src/shared/terminal/terminal.model';
import { TabId, type SavedTab } from '../../src/shared/workspace/workspace.model';
import { layerProjectStore, ProjectStore } from '../projects/project-store';
import { layerWorkspaceHandlers } from './workspace';

const roots: string[] = [];
const dbFile = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'timmy-workspace-'));
  roots.push(dir);
  return path.join(dir, 'timmy.db');
};
afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

/** The Workspace handlers over the database `file`; providing it again later is the app restarting. */
const appOn = (file: string) => {
  // One store for the handlers and for the test, which adds Projects to it as the Projects RPCs would.
  const store = layerProjectStore(file);
  return Layer.merge(
    makeDesktopTestLayer(
      Layer.mergeAll(
        layerWorkspaceHandlers.pipe(Layer.provide(store)),
        AppInfoRpcs.toLayer({ 'AppInfo.get': () => Effect.die('unused') }),
        layerWindowUnused,
        layerSettingsUnused,
        layerProjectsUnused,
        layerFilesUnused,
      ),
    ),
    store,
  );
};

/** Adds a Project to the list, as the Projects RPCs would. */
const addProject = (cwd: string) => Effect.flatMap(ProjectStore, (store) => store.add(cwd)).pipe(Effect.map((project) => project.projectId));

const terminal = (id: string, number: number, name?: string, provider?: Provider) => ({
  terminalId: TerminalId.make(id),
  number,
  ...(name === undefined ? {} : { name }),
  ...(provider === undefined ? {} : { provider }),
});
const tab = (id: string, terminals: SavedTab['terminals']): SavedTab => ({ tabId: TabId.make(id), terminals });

const save = (projectId: ProjectId, tabs: ReadonlyArray<SavedTab>, lastNumber: number) =>
  Effect.flatMap(DesktopApi, (api) => api['Workspace.save']({ projectId, tabs, lastNumber }));
const rename = (projectId: ProjectId, number: number, name: string) =>
  Effect.flatMap(DesktopApi, (api) => api['Workspace.renameTerminal']({ projectId, number, name }));
const load = Effect.flatMap(DesktopApi, (api) => api['Workspace.load']());

describe('Workspace RPCs: a Terminal has a name and a number', () => {
  it.effect('saves each Terminal with its name and gives it back', () =>
    Effect.gen(function* () {
      const timmy = yield* addProject('/work/timmy');
      const tabs = [tab('t1', [terminal('a', 1, 'claude 1', 'ClaudeCode'), terminal('b', 2, 'build')])];
      yield* save(timmy, tabs, 2);
      expect(yield* load).toEqual([{ projectId: timmy, tabs, lastNumber: 2 }]);
    }).pipe(Effect.provide(appOn(':memory:'))),
  );

  it.effect('refuses a name another Terminal of the Project has, in any case, and keeps the old one', () =>
    Effect.gen(function* () {
      const timmy = yield* addProject('/work/timmy');
      yield* save(timmy, [tab('t1', [terminal('a', 1, 'claude 1', 'ClaudeCode'), terminal('b', 2, 'Build')])], 2);
      const error = yield* rename(timmy, 1, '  build ').pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: 'WorkspaceError', reason: 'NameTaken' });
      expect((yield* load)[0]?.tabs[0]?.terminals.map((each) => each.name)).toEqual(['claude 1', 'Build']);
    }).pipe(Effect.provide(appOn(':memory:'))),
  );

  it.effect('counts a Terminal saved without a name under its default one', () =>
    Effect.gen(function* () {
      const timmy = yield* addProject('/work/timmy');
      yield* save(timmy, [tab('t1', [terminal('a', 1), terminal('b', 2, undefined, 'Codex')])], 2);
      expect((yield* rename(timmy, 1, 'Codex 2').pipe(Effect.flip)).reason).toBe('NameTaken');
      expect((yield* rename(timmy, 2, 'SHELL 1').pipe(Effect.flip)).reason).toBe('NameTaken');
    }).pipe(Effect.provide(appOn(':memory:'))),
  );

  it.effect('renames a Terminal to a free name, its own in another case, or a name used in another Project', () =>
    Effect.gen(function* () {
      const timmy = yield* addProject('/work/timmy');
      const ascua = yield* addProject('/work/ascua');
      yield* save(timmy, [tab('t1', [terminal('a', 1, 'claude 1', 'ClaudeCode'), terminal('b', 2, 'shell 2')])], 2);
      yield* save(ascua, [tab('t2', [terminal('c', 1, 'tests')])], 1);
      yield* rename(timmy, 1, 'tests');
      yield* rename(timmy, 2, 'SHELL 2');
      // `load` does not promise an order of Projects, so each is looked up by id.
      const layouts = yield* load;
      const namesOf = (projectId: ProjectId) => layouts.find((each) => each.projectId === projectId)?.tabs[0]?.terminals.map((saved) => saved.name);
      expect(namesOf(timmy)).toEqual(['tests', 'SHELL 2']);
      expect(namesOf(ascua)).toEqual(['tests']);
    }).pipe(Effect.provide(appOn(':memory:'))),
  );

  it.effect('renames only the Terminal of that Project with that number', () =>
    Effect.gen(function* () {
      const timmy = yield* addProject('/work/timmy');
      const ascua = yield* addProject('/work/ascua');
      yield* save(timmy, [tab('t1', [terminal('a', 1, 'shell 1')])], 1);
      yield* save(ascua, [tab('t2', [terminal('c', 1, 'tests')])], 1);
      yield* rename(timmy, 1, 'deploy');
      const names = Object.fromEntries((yield* load).map((each) => [each.projectId, each.tabs[0]?.terminals.map((saved) => saved.name)]));
      expect(names).toEqual({ [timmy]: ['deploy'], [ascua]: ['tests'] });
    }).pipe(Effect.provide(appOn(':memory:'))),
  );

  it.effect('lets a Terminal restarted in place change the case of its name, though the store still holds it under its old id', () =>
    Effect.gen(function* () {
      const timmy = yield* addProject('/work/timmy');
      yield* save(timmy, [tab('t1', [terminal('old-id', 2, 'claude 2', 'ClaudeCode')])], 2);
      yield* rename(timmy, 2, 'Claude 2');
      expect((yield* load)[0]?.tabs[0]?.terminals[0]?.name).toBe('Claude 2');
    }).pipe(Effect.provide(appOn(':memory:'))),
  );

  it.effect('refuses a blank name', () =>
    Effect.gen(function* () {
      const timmy = yield* addProject('/work/timmy');
      yield* save(timmy, [tab('t1', [terminal('a', 1, 'shell 1')])], 1);
      expect((yield* rename(timmy, 1, '   ').pipe(Effect.flip)).reason).toBe('NameEmpty');
    }).pipe(Effect.provide(appOn(':memory:'))),
  );

  it.effect('never gives back a lower number: closing the newest Terminal does not free its number', () =>
    Effect.gen(function* () {
      const timmy = yield* addProject('/work/timmy');
      yield* save(timmy, [tab('t1', [terminal('a', 1), terminal('b', 2), terminal('c', 3)])], 3);
      yield* save(timmy, [tab('t1', [terminal('a', 1)])], 1);
      expect((yield* load)[0]?.lastNumber).toBe(3);
      // A Terminal opened and closed between two saves still counts.
      yield* save(timmy, [tab('t1', [terminal('a', 1)])], 5);
      yield* save(timmy, [], 0);
      expect(yield* load).toEqual([{ projectId: timmy, tabs: [], lastNumber: 5 }]);
    }).pipe(Effect.provide(appOn(':memory:'))),
  );

  it.effect('keeps names and the last number across a restart of Timmy', () => {
    const file = dbFile();
    return Effect.gen(function* () {
      const timmy = yield* addProject('/work/timmy').pipe(Effect.provide(appOn(file)));
      yield* Effect.gen(function* () {
        yield* save(timmy, [tab('t1', [terminal('a', 4, 'build')])], 7);
        yield* rename(timmy, 4, 'deploy');
      }).pipe(Effect.provide(appOn(file)));
      const [restored] = yield* load.pipe(Effect.provide(appOn(file)));
      expect(restored).toEqual({ projectId: timmy, tabs: [tab('t1', [terminal('a', 4, 'deploy')])], lastNumber: 7 });
    });
  });

  it.effect('restores a layout saved before Terminals had names with no names, and counts its numbers', () => {
    const file = dbFile();
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, cwd TEXT NOT NULL, created_at INTEGER NOT NULL, name TEXT NOT NULL DEFAULT '', listed INTEGER NOT NULL DEFAULT 0, last_used_at INTEGER);
      CREATE TABLE ui_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE tabs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, position INTEGER NOT NULL, name TEXT, layout TEXT);
      CREATE TABLE terminals (id TEXT PRIMARY KEY, tab_id TEXT NOT NULL REFERENCES tabs(id) ON DELETE CASCADE, position INTEGER NOT NULL, number INTEGER NOT NULL, provider TEXT);
      INSERT INTO projects (id, cwd, created_at, name, listed) VALUES ('p1', '/work/app', 1, 'app', 1);
      INSERT INTO tabs (id, project_id, position) VALUES ('t1', 'p1', 0);
      INSERT INTO terminals (id, tab_id, position, number, provider) VALUES ('a', 't1', 0, 2, 'ClaudeCode'), ('b', 't1', 1, 5, NULL);
      PRAGMA user_version = 5;
    `);
    old.close();
    return Effect.gen(function* () {
      const [restored] = yield* load;
      expect(restored?.tabs[0]?.terminals).toEqual([terminal('a', 2, undefined, 'ClaudeCode'), terminal('b', 5)]);
      expect(restored?.lastNumber).toBe(5);
    }).pipe(Effect.provide(appOn(file)));
  });
});
