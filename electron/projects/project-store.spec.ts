import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { ProjectId } from '../../src/shared/projects/projects.model';
import { TerminalId } from '../../src/shared/terminal/terminal.model';
import { PaneId, TabId, type SavedTab } from '../../src/shared/workspace/workspace.model';
import { projectIdOfCwd } from './project-id';
import { layerProjectStore, ProjectStore } from './project-store';

const at = (...parts: string[]) => path.resolve('/disk', ...parts);

const withStore = <A, E>(body: (store: ProjectStore['Service']) => Effect.Effect<A, E>, file = ':memory:') =>
  Effect.gen(function* () {
    return yield* body(yield* ProjectStore);
  }).pipe(Effect.provide(layerProjectStore(file)));

describe('ProjectStore', () => {
  it.effect('lists the projects added, in the order they were added', () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.add(at('b'));
        yield* store.add(at('a'), '  Mine ');
        expect((yield* store.list).map((p) => [p.cwd, p.name, p.lastUsedAt])).toEqual([
          [at('b'), 'b', null],
          [at('a'), 'Mine', null],
        ]);
      }),
    ));

  it.effect('finds a project by id and by folder, and not once it is removed', () =>
    withStore((store) =>
      Effect.gen(function* () {
        const added = yield* store.add(at('app'));
        expect(added.projectId).toBe(projectIdOfCwd(at('app')));
        expect(yield* store.find(added.projectId)).toEqual(Option.some(added));
        expect(yield* store.findByCwd(at('app'))).toEqual(Option.some(added));
        yield* store.remove(added.projectId);
        expect(Option.isNone(yield* store.find(added.projectId))).toBe(true);
        expect(yield* store.list).toEqual([]);
      }),
    ));

  it.effect('lists a removed project again, under the new name, when its folder is added back', () =>
    withStore((store) =>
      Effect.gen(function* () {
        const first = yield* store.add(at('app'), 'old');
        yield* store.remove(first.projectId);
        const again = yield* store.add(at('app'), 'new');
        expect(again).toMatchObject({ projectId: first.projectId, name: 'new' });
      }),
    ));

  it.effect('remembers when a project was last opened', () =>
    withStore((store) =>
      Effect.gen(function* () {
        const { projectId } = yield* store.add(at('app'));
        yield* store.touch(projectId);
        expect((yield* store.find(projectId)).pipe(Option.map((p) => p.lastUsedAt !== null))).toEqual(Option.some(true));
      }),
    ));

  describe('the saved layout', () => {
    const term = (id: string, number: number, provider?: 'ClaudeCode') => ({ terminalId: TerminalId.make(id), number, ...(provider === undefined ? {} : { provider }) });
    const tab = (id: string, terminals: SavedTab['terminals'], name?: string): SavedTab => {
      const panes = terminals.map((t) => ({ kind: 'pane' as const, pane: { id: PaneId.make(t.terminalId), views: [t.terminalId], expanded: t.terminalId } }));
      return {
        tabId: TabId.make(id),
        ...(name === undefined ? {} : { name }),
        terminals,
        layout: {
          root:
            panes.length === 1
              ? panes[0]
              : { kind: 'split', direction: 'right', children: panes, sizes: panes.map(() => 1 / panes.length) },
          focused: PaneId.make(terminals[0].terminalId),
        },
      };
    };

    it.effect('gives back the Tabs of a Project as they were saved: order, names, Terminals, Providers and layout', () =>
      withStore((store) =>
        Effect.gen(function* () {
          const { projectId } = yield* store.add(at('app'));
          const tabs = [tab('t1', [term('a', 1, 'ClaudeCode'), term('b', 2)], 'Work'), tab('t2', [term('c', 3)])];
          yield* store.saveLayout(projectId, tabs);
          expect(yield* store.layouts).toEqual([{ projectId, tabs }]);
        }),
      ));

    it.effect('replaces what was saved: a Tab, Pane or Terminal that is gone leaves the store', () =>
      withStore((store) =>
        Effect.gen(function* () {
          const { projectId } = yield* store.add(at('app'));
          yield* store.saveLayout(projectId, [tab('t1', [term('a', 1), term('b', 2)]), tab('t2', [term('c', 3)])]);
          const after = [tab('t1', [term('a', 1)])];
          yield* store.saveLayout(projectId, after);
          expect(yield* store.layouts).toEqual([{ projectId, tabs: after }]);
          yield* store.saveLayout(projectId, []);
          expect(yield* store.layouts).toEqual([]);
        }),
      ));

    it.effect('keeps the Projects apart', () =>
      withStore((store) =>
        Effect.gen(function* () {
          const one = yield* store.add(at('one'));
          const two = yield* store.add(at('two'));
          yield* store.saveLayout(one.projectId, [tab('t1', [term('a', 1)])]);
          yield* store.saveLayout(two.projectId, [tab('t2', [term('b', 1)])]);
          yield* store.saveLayout(one.projectId, []);
          expect((yield* store.layouts).map((each) => each.projectId)).toEqual([two.projectId]);
        }),
      ));

    it.effect('forgets the layout of a Project that is removed, and ignores a save for one that is not listed', () =>
      withStore((store) =>
        Effect.gen(function* () {
          const { projectId } = yield* store.add(at('app'));
          yield* store.saveLayout(projectId, [tab('t1', [term('a', 1)])]);
          yield* store.remove(projectId);
          expect(yield* store.layouts).toEqual([]);
          yield* store.saveLayout(projectId, [tab('t1', [term('a', 1)])]);
          yield* store.add(at('app'));
          expect(yield* store.layouts).toEqual([]);
        }),
      ));

    it.effect('gives a Tab whose saved layout cannot be read no layout, and keeps its Terminals', () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'timmy-layout-'));
      const file = path.join(dir, 'layout.db');
      return withStore(
        (store) =>
          Effect.gen(function* () {
            const { projectId } = yield* store.add(at('app'));
            yield* store.saveLayout(projectId, [tab('t1', [term('a', 1)])]);
          }),
        file,
      ).pipe(
        Effect.andThen(
          Effect.sync(() => {
            const db = new DatabaseSync(file);
            db.exec("UPDATE tabs SET layout = '{not json'");
            db.close();
          }),
        ),
        Effect.andThen(
          withStore(
            (store) =>
              Effect.gen(function* () {
                const [saved] = yield* store.layouts;
                expect(saved.tabs).toEqual([{ tabId: 't1', terminals: [term('a', 1)] }]);
              }),
            file,
          ),
        ),
        Effect.ensuring(Effect.sync(() => rmSync(dir, { recursive: true, force: true }))),
      );
    });

    it.effect('migrates a database from before the layout was saved without losing Projects', () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'timmy-layout-old-'));
      const file = path.join(dir, 'old.db');
      const old = new DatabaseSync(file);
      old.exec(`
        CREATE TABLE projects (id TEXT PRIMARY KEY, cwd TEXT NOT NULL, created_at INTEGER NOT NULL, name TEXT NOT NULL DEFAULT '', listed INTEGER NOT NULL DEFAULT 0, last_used_at INTEGER);
        CREATE TABLE ui_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO projects (id, cwd, created_at, name, listed) VALUES ('p1', '/work/app', 1, 'app', 1);
        INSERT INTO ui_state (key, value) VALUES ('files.width', '300');
        PRAGMA user_version = 4;
      `);
      old.close();
      return withStore(
        (store) =>
          Effect.gen(function* () {
            expect((yield* store.list).map((p) => p.name)).toEqual(['app']);
            expect(yield* store.getState('files.width')).toEqual(Option.some('300'));
            expect(yield* store.layouts).toEqual([]);
            yield* store.saveLayout(ProjectId.make('p1'), [tab('t1', [term('a', 1)])]);
            expect((yield* store.layouts).length).toBe(1);
          }),
        file,
      ).pipe(Effect.ensuring(Effect.sync(() => rmSync(dir, { recursive: true, force: true }))));
    });
  });

  describe('opening a database left by a version that stored Chat sessions', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'timmy-store-'));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it.effect('keeps the listed projects and drops the sessions', () => {
      const file = path.join(dir, 'old.db');
      const old = new DatabaseSync(file);
      old.exec(`
        CREATE TABLE projects (id TEXT PRIMARY KEY, cwd TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id));
        CREATE TABLE entries (seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id));
        ALTER TABLE projects ADD COLUMN name TEXT NOT NULL DEFAULT '';
        ALTER TABLE projects ADD COLUMN listed INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE projects ADD COLUMN last_used_at INTEGER;
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO projects (id, cwd, created_at, name, listed) VALUES ('p1', '/work/app', 1, 'app', 1);
        INSERT INTO projects (id, cwd, created_at, name, listed) VALUES ('p2', '/work/implicit', 2, '', 0);
        INSERT INTO sessions (id, project_id) VALUES ('s1', 'p1');
        INSERT INTO entries (session_id) VALUES ('s1');
        PRAGMA user_version = 2;
      `);
      old.close();

      return withStore(
        (store) =>
          Effect.gen(function* () {
            expect((yield* store.list).map((p) => p.name)).toEqual(['app']);
          }),
        file,
      ).pipe(
        Effect.andThen(
          Effect.sync(() => {
            const db = new DatabaseSync(file);
            const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r['name']);
            db.close();
            expect(tables).toEqual(['projects', 'ui_state', 'tabs', 'terminals']);
          }),
        ),
      );
    });
  });
});
