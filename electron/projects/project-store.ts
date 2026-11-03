import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { Clock, Context, Effect, Layer, Option, Schema } from 'effect';
import { Project, type ProjectId } from '../../src/shared/projects/projects.model';
import { projectIdOfCwd } from './project-id';

/** The name a project gets when the user does not choose one: the name of its folder. */
export const defaultProjectName = (cwd: string): string => path.basename(cwd) || cwd;

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
];

const SELECT_PROJECT = `
  SELECT id AS projectId, cwd, name, created_at AS createdAt, last_used_at AS lastUsedAt
  FROM projects WHERE listed = 1`;

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
        remove: (projectId) => run('UPDATE projects SET listed = 0 WHERE id = ?', projectId),
        touch: (projectId) =>
          Clock.currentTimeMillis.pipe(
            Effect.flatMap((now) => run('UPDATE projects SET last_used_at = ? WHERE id = ?', now, projectId)),
          ),
      });
    }),
  );
