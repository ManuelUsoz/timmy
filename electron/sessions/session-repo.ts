import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { Clock, Context, Effect, Layer, Option, PubSub, Schema, Stream } from 'effect';
import { AgentId, SessionId } from '../../src/shared/chat/ids.model';
import { ProviderId } from '../../src/shared/chat/provider.model';
import {
  ProjectId,
  ProviderSessionId,
  SessionSummary,
  type TranscriptRef,
} from '../../src/shared/sessions/sessions.model';

/** One stored line of a provider transcript. `native` is the provider's own entry, kept verbatim. */
export interface TranscriptEntry {
  readonly kind: string;
  readonly uuid?: string;
  readonly timestamp?: string;
  readonly native: unknown;
}

export interface NewSession {
  readonly sessionId: SessionId;
  readonly projectId: ProjectId;
  readonly cwd: string;
  readonly provider: ProviderId;
  readonly providerSessionId: ProviderSessionId;
}

/**
 * Persistent store of projects, sessions and their transcripts. It never interprets a
 * transcript entry. Storage failures are defects: no caller can act on them.
 */
export class SessionRepo extends Context.Service<
  SessionRepo,
  {
    /** Registers the project of `cwd` under `projectId`; a no-op when it already exists. */
    readonly ensureProject: (projectId: ProjectId, cwd: string) => Effect.Effect<void>;
    readonly createSession: (session: NewSession) => Effect.Effect<void>;
    readonly get: (sessionId: SessionId) => Effect.Effect<Option.Option<SessionSummary>>;
    readonly findByProvider: (
      provider: ProviderId,
      providerSessionId: ProviderSessionId,
    ) => Effect.Effect<Option.Option<SessionSummary>>;
    /** Most recently updated first. */
    readonly list: (projectId: ProjectId) => Effect.Effect<ReadonlyArray<SessionSummary>>;
    /** Entries with a `uuid` already stored are ignored, so a retried batch is harmless. */
    readonly append: (ref: TranscriptRef, entries: ReadonlyArray<TranscriptEntry>) => Effect.Effect<void>;
    /** `None` when nothing was ever appended to the transcript. */
    readonly load: (ref: TranscriptRef) => Effect.Effect<Option.Option<ReadonlyArray<TranscriptEntry>>>;
    readonly subagents: (sessionId: SessionId) => Effect.Effect<ReadonlyArray<AgentId>>;
    /** Names the session only if it has no title yet and the user never renamed it. */
    readonly setAutoTitle: (sessionId: SessionId, title: string) => Effect.Effect<void>;
    readonly rename: (sessionId: SessionId, title: string) => Effect.Effect<void>;
    readonly touch: (sessionId: SessionId) => Effect.Effect<void>;
    /** Removes the session with all its transcripts. */
    readonly remove: (sessionId: SessionId) => Effect.Effect<void>;
    /** Emits whenever a session is created, titled, touched or removed. Bursts may collapse into one emission. */
    readonly changes: Stream.Stream<void>;
  }
>()('sessions/SessionRepo') {}

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
];

const SELECT_SESSION = `
  SELECT s.id AS sessionId, s.project_id AS projectId, s.provider AS provider,
         s.provider_session_id AS providerSessionId, p.cwd AS cwd, s.title AS title,
         s.created_at AS createdAt, s.updated_at AS updatedAt
  FROM sessions s JOIN projects p ON p.id = s.project_id`;

const EntryRow = Schema.Struct({
  kind: Schema.String,
  uuid: Schema.NullOr(Schema.String),
  ts: Schema.NullOr(Schema.String),
  native: Schema.String,
});

const SubRow = Schema.Struct({ sub: AgentId });

const decodeSessions = Schema.decodeUnknownEffect(Schema.Array(SessionSummary));
const decodeEntryRows = Schema.decodeUnknownEffect(Schema.Array(EntryRow));
const decodeSubRows = Schema.decodeUnknownEffect(Schema.Array(SubRow));

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
export const layerSessionRepo = (path: string) =>
  Layer.effect(
    SessionRepo,
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

      const changed = yield* PubSub.sliding<void>(1);
      /** Runs a write to the sessions table, then tells subscribers. */
      const mutate = (sql: string, ...params: ReadonlyArray<SQLInputValue>) =>
        run(sql, ...params).pipe(Effect.andThen(PubSub.publish(changed, undefined)));

      const findSessions = (where: string, ...params: ReadonlyArray<SQLInputValue>) =>
        all(`${SELECT_SESSION} ${where}`, ...params).pipe(
          Effect.flatMap(decodeSessions),
          Effect.orDie,
        );

      const ensureProject = Effect.fn('SessionRepo.ensureProject')(function* (projectId: ProjectId, cwd: string) {
        const now = yield* Clock.currentTimeMillis;
        yield* run('INSERT OR IGNORE INTO projects (id, cwd, created_at) VALUES (?, ?, ?)', projectId, cwd, now);
      });

      return SessionRepo.of({
        ensureProject,
        createSession: Effect.fn('SessionRepo.createSession')(function* (session) {
          const now = yield* Clock.currentTimeMillis;
          yield* ensureProject(session.projectId, session.cwd);
          yield* mutate(
            `INSERT INTO sessions (id, project_id, provider, provider_session_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            session.sessionId,
            session.projectId,
            session.provider,
            session.providerSessionId,
            now,
            now,
          );
        }),
        get: (sessionId) =>
          findSessions('WHERE s.id = ?', sessionId).pipe(Effect.map((rows) => Option.fromNullishOr(rows[0]))),
        findByProvider: (provider, providerSessionId) =>
          findSessions('WHERE s.provider = ? AND s.provider_session_id = ?', provider, providerSessionId).pipe(
            Effect.map((rows) => Option.fromNullishOr(rows[0])),
          ),
        list: (projectId) => findSessions('WHERE s.project_id = ? ORDER BY s.updated_at DESC', projectId),
        append: Effect.fn('SessionRepo.append')(function* (ref, entries) {
          const now = yield* Clock.currentTimeMillis;
          const sub = ref.subagent ?? '';
          yield* Effect.sync(() => {
            db.exec('BEGIN IMMEDIATE');
            try {
              const insert = db.prepare(
                'INSERT OR IGNORE INTO entries (session_id, sub, kind, uuid, ts, native) VALUES (?, ?, ?, ?, ?, ?)',
              );
              for (const entry of entries) {
                insert.run(
                  ref.sessionId,
                  sub,
                  entry.kind,
                  entry.uuid ?? null,
                  entry.timestamp ?? null,
                  JSON.stringify(entry.native),
                );
              }
              db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, ref.sessionId);
              db.exec('COMMIT');
            } catch (error) {
              db.exec('ROLLBACK');
              throw error;
            }
          });
        }),
        load: Effect.fn('SessionRepo.load')(function* (ref) {
          const rows = yield* all(
            'SELECT kind, uuid, ts, native FROM entries WHERE session_id = ? AND sub = ? ORDER BY seq',
            ref.sessionId,
            ref.subagent ?? '',
          ).pipe(Effect.flatMap(decodeEntryRows), Effect.orDie);
          if (rows.length === 0) return Option.none();
          const entries = yield* Effect.forEach(rows, (row) =>
            Effect.try({ try: (): unknown => JSON.parse(row.native), catch: (cause) => cause }).pipe(
              Effect.map(
                (native): TranscriptEntry => ({
                  kind: row.kind,
                  native,
                  ...(row.uuid === null ? {} : { uuid: row.uuid }),
                  ...(row.ts === null ? {} : { timestamp: row.ts }),
                }),
              ),
            ),
          ).pipe(Effect.orDie);
          return Option.some(entries);
        }),
        subagents: (sessionId) =>
          all(
            "SELECT sub FROM entries WHERE session_id = ? AND sub <> '' GROUP BY sub ORDER BY MIN(seq)",
            sessionId,
          ).pipe(
            Effect.flatMap(decodeSubRows),
            Effect.map((rows) => rows.map((row) => row.sub)),
            Effect.orDie,
          ),
        setAutoTitle: (sessionId, title) =>
          mutate("UPDATE sessions SET title = ? WHERE id = ? AND title_source = 'Auto' AND title = ''", title, sessionId),
        rename: (sessionId, title) =>
          mutate("UPDATE sessions SET title = ?, title_source = 'User' WHERE id = ?", title, sessionId),
        touch: (sessionId) =>
          Clock.currentTimeMillis.pipe(
            Effect.flatMap((now) => mutate('UPDATE sessions SET updated_at = ? WHERE id = ?', now, sessionId)),
          ),
        remove: (sessionId) => mutate('DELETE FROM sessions WHERE id = ?', sessionId),
        changes: Stream.fromPubSub(changed),
      });
    }),
  );
