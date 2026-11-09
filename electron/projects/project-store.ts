import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { Clock, Context, Effect, Layer, Option, Schema } from 'effect';
import { Project, type ProjectId } from '../../src/shared/projects/projects.model';
import { ProjectLayout as ProjectLayoutSchema, SavedTab, TabLayout, type ProjectLayout, type SavedTab as SavedTabType } from '../../src/shared/workspace/workspace.model';
import { projectIdOfCwd } from './project-id';

/** The name a project gets when the user does not choose one: the name of its folder. */
const defaultProjectName = (cwd: string): string => path.basename(cwd) || cwd;

/**
 * The projects in the user's list, persisted. The only place that knows how a folder maps to a project id.
 * Storage failures are defects: no caller can act on them.
 */
export class ProjectStore extends Context.Service<
  ProjectStore,
  {
    readonly list: Effect.Effect<ReadonlyArray<Project>>;
    readonly find: (projectId: ProjectId) => Effect.Effect<Option.Option<Project>>;
    /** The project in the list that owns the folder `cwd`. */
    readonly findByCwd: (cwd: string) => Effect.Effect<Option.Option<Project>>;
    /** Puts the folder in the list under `name` (the name of the folder when blank), whether it is new or was removed. */
    readonly add: (cwd: string, name?: string) => Effect.Effect<Project>;
    /** Takes the project out of the list; nothing else changes. */
    readonly remove: (projectId: ProjectId) => Effect.Effect<void>;
    /** Remembers the project as the last one opened. */
    readonly touch: (projectId: ProjectId) => Effect.Effect<void>;
    /** A small piece of UI state a feature keeps under its own key; the store does not look inside it. */
    readonly getState: (key: string) => Effect.Effect<Option.Option<string>>;
    readonly putState: (key: string, value: string) => Effect.Effect<void>;
    /** The saved Tabs of every listed Project (ADR 0011); a Project with none is left out. */
    readonly layouts: Effect.Effect<ReadonlyArray<ProjectLayout>>;
    /**
     * Saves the Project's Tabs in place of what was saved, so a Tab, Pane or Terminal that is gone leaves the store.
     * Nothing is saved for a Project that is not listed.
     */
    readonly saveLayout: (projectId: ProjectId, tabs: ReadonlyArray<SavedTabType>) => Effect.Effect<void>;
  }
>()('projects/ProjectStore') {}

/**
 * Migrations run in order and are never edited once released: `user_version` says how many a database has had.
 * The first two also built the tables of the Chat's sessions, which the third drops.
 */
const migrations: ReadonlyArray<string> = [
  `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    cwd TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    provider TEXT NOT NULL,
    provider_session_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    title_source TEXT NOT NULL DEFAULT 'Auto' CHECK (title_source IN ('Auto', 'User')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (provider, provider_session_id)
  );
  CREATE INDEX sessions_by_project ON sessions(project_id, updated_at DESC);
  CREATE TABLE entries (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    sub TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL,
    uuid TEXT,
    ts TEXT,
    native TEXT NOT NULL
  );
  CREATE INDEX entries_by_transcript ON entries(session_id, sub, seq);
  CREATE UNIQUE INDEX entries_by_uuid ON entries(session_id, sub, uuid) WHERE uuid IS NOT NULL;
  `,
  `
  ALTER TABLE projects ADD COLUMN name TEXT NOT NULL DEFAULT '';
  ALTER TABLE projects ADD COLUMN listed INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE projects ADD COLUMN last_used_at INTEGER;
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
  // Timmy no longer stores Provider conversations (ADR 0008): the CLIs keep their own.
  `
  DROP TABLE entries;
  DROP TABLE sessions;
  DROP TABLE meta;
  `,
  // UI state that outlives a restart, kept by the feature that owns each key.
  `
  CREATE TABLE ui_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
  // The Tabs of each Project and the Terminals in them (ADR 0011). A Terminal belongs to exactly one Tab, so it goes with it.
  `
  CREATE TABLE tabs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    name TEXT,
    layout TEXT
  );
  CREATE INDEX tabs_by_project ON tabs(project_id, position);
  CREATE TABLE terminals (
    id TEXT PRIMARY KEY,
    tab_id TEXT NOT NULL REFERENCES tabs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    number INTEGER NOT NULL,
    provider TEXT
  );
  CREATE INDEX terminals_by_tab ON terminals(tab_id, position);
  `,
];

const SELECT_PROJECT = `
  SELECT id AS projectId, cwd, name, created_at AS createdAt, last_used_at AS lastUsedAt
  FROM projects WHERE listed = 1`;

const LayoutJson = Schema.fromJsonString(TabLayout);
const encodeLayout = Schema.encodeSync(LayoutJson);
const decodeLayout = Schema.decodeUnknownOption(LayoutJson);
const decodeTerminal = Schema.decodeUnknownEffect(SavedTab.fields.terminals);

const decodeProjects = Schema.decodeUnknownEffect(Schema.Array(Project));

const migrate = (db: DatabaseSync): void => {
  const current = Number(db.prepare('PRAGMA user_version').get()?.['user_version'] ?? 0);
  migrations.slice(current).forEach((sql, offset) => {
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${current + offset + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      // eslint-disable-next-line no-restricted-syntax -- rethrow so the SQLite transaction rolls back; acquireRelease turns it into a defect
      throw error;
    }
  });
};

/** `path` is a database file, or `:memory:` for tests. */
export const layerProjectStore = (path: string) =>
  Layer.effect(
    ProjectStore,
    Effect.gen(function* () {
      const db = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const opened = new DatabaseSync(path);
          opened.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
          migrate(opened);
          return opened;
        }),
        (opened) => Effect.sync(() => opened.close()),
      );

      const all = (sql: string, ...params: ReadonlyArray<SQLInputValue>) =>
        Effect.sync(() => db.prepare(sql).all(...params));
      const run = (sql: string, ...params: ReadonlyArray<SQLInputValue>) =>
        Effect.sync(() => void db.prepare(sql).run(...params));

      const findProjects = (where: string, ...params: ReadonlyArray<SQLInputValue>) =>
        all(`${SELECT_PROJECT} ${where}`, ...params).pipe(Effect.flatMap(decodeProjects), Effect.orDie);

      const find = (projectId: ProjectId) =>
        findProjects('AND id = ?', projectId).pipe(Effect.map((rows) => Option.fromNullishOr(rows[0])));

      const loadLayouts = Effect.gen(function* () {
        const tabRows = yield* all(
          `SELECT tabs.id AS tabId, tabs.project_id AS projectId, tabs.name AS name, tabs.layout AS layout
           FROM tabs JOIN projects ON projects.id = tabs.project_id
           WHERE projects.listed = 1 ORDER BY tabs.project_id, tabs.position`,
        );
        const terminalRows = yield* all(
          'SELECT tab_id AS tabId, id AS terminalId, number, provider FROM terminals ORDER BY tab_id, position',
        );
        const projects = new Map<string, SavedTabType[]>();
        for (const row of tabRows) {
          const terminals = yield* decodeTerminal(
            terminalRows
              .filter((terminal) => terminal['tabId'] === row['tabId'])
              .map((terminal) => ({
                terminalId: terminal['terminalId'],
                number: terminal['number'],
                ...(terminal['provider'] === null ? {} : { provider: terminal['provider'] }),
              })),
          );
          const layout = typeof row['layout'] === 'string' ? decodeLayout(row['layout']) : Option.none();
          const tab = yield* Schema.decodeUnknownEffect(SavedTab)({
            tabId: row['tabId'],
            ...(row['name'] === null ? {} : { name: row['name'] }),
            terminals,
            ...(Option.isSome(layout) ? { layout: layout.value } : {}),
          });
          const key = String(row['projectId']);
          projects.set(key, [...(projects.get(key) ?? []), tab]);
        }
        return yield* Schema.decodeUnknownEffect(Schema.Array(ProjectLayoutSchema))(
          Array.from(projects, ([projectId, tabs]) => ({ projectId, tabs })),
        );
      }).pipe(Effect.orDie);

      return ProjectStore.of({
        list: findProjects('ORDER BY created_at'),
        find,
        findByCwd: (cwd) => find(projectIdOfCwd(cwd)),
        add: Effect.fn('ProjectStore.add')(function* (cwd, name) {
          const projectId = projectIdOfCwd(cwd);
          const trimmed = name?.trim() ?? '';
          const now = yield* Clock.currentTimeMillis;
          yield* run(
            `INSERT INTO projects (id, cwd, created_at, name, listed) VALUES (?, ?, ?, ?, 1)
             ON CONFLICT(id) DO UPDATE SET cwd = excluded.cwd, name = excluded.name, listed = 1`,
            projectId,
            cwd,
            now,
            trimmed === '' ? defaultProjectName(cwd) : trimmed,
          );
          return yield* find(projectId).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.die(`Project ${projectId} vanished right after it was saved`),
                onSome: Effect.succeed,
              }),
            ),
          );
        }),
        remove: (projectId) =>
          Effect.sync(() => {
            db.prepare('UPDATE projects SET listed = 0 WHERE id = ?').run(projectId);
            // Its Tabs go with it: a Project added back later starts with none.
            db.prepare('DELETE FROM tabs WHERE project_id = ?').run(projectId);
          }),
        touch: (projectId) =>
          Clock.currentTimeMillis.pipe(
            Effect.flatMap((now) => run('UPDATE projects SET last_used_at = ? WHERE id = ?', now, projectId)),
          ),
        getState: (key) =>
          all('SELECT value FROM ui_state WHERE key = ?', key).pipe(
            Effect.map((rows) => Option.fromNullishOr(rows[0]).pipe(Option.map((row) => String(row['value'])))),
          ),
        layouts: loadLayouts,
        saveLayout: (projectId, tabs) =>
          Effect.sync(() => {
            if (db.prepare('SELECT 1 FROM projects WHERE id = ? AND listed = 1').get(projectId) === undefined) return;
            db.exec('BEGIN');
            try {
              // Replaced whole: what is no longer in `tabs` is deleted, its Terminals with it.
              db.prepare('DELETE FROM tabs WHERE project_id = ?').run(projectId);
              const insertTab = db.prepare('INSERT INTO tabs (id, project_id, position, name, layout) VALUES (?, ?, ?, ?, ?)');
              const insertTerminal = db.prepare('INSERT INTO terminals (id, tab_id, position, number, provider) VALUES (?, ?, ?, ?, ?)');
              tabs.forEach((tab, tabPosition) => {
                insertTab.run(tab.tabId, projectId, tabPosition, tab.name ?? null, tab.layout === undefined ? null : encodeLayout(tab.layout));
                tab.terminals.forEach((terminal, position) =>
                  insertTerminal.run(terminal.terminalId, tab.tabId, position, terminal.number, terminal.provider ?? null),
                );
              });
              db.exec('COMMIT');
            } catch (error) {
              db.exec('ROLLBACK');
              // eslint-disable-next-line no-restricted-syntax -- rethrow after the rollback; Effect.sync turns it into a defect
              throw error;
            }
          }),
        putState: (key, value) =>
          run('INSERT INTO ui_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value),
      });
    }),
  );
