import { afterAll, describe, expect, it } from '@effect/vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Effect, Layer, Option, Ref, Stream } from 'effect';
import { AttachmentId } from '../../src/shared/attachments/attachment.model';
import { ChatError } from '../../src/shared/chat/chat-error.model';
import { ChatEvent } from '../../src/shared/chat/event.model';
import { SessionId, TurnId } from '../../src/shared/chat/ids.model';
import { ProviderId } from '../../src/shared/chat/provider.model';
import { SessionOptions } from '../../src/shared/chat/session.model';
import { ProviderSessionId } from '../../src/shared/sessions/sessions.model';
import { layerProjectFiles } from '../files/project-files';
import { UserMessage } from '../../src/shared/chat/session.model';
import { layerProjectResolver } from '../sessions/project-resolver';
import { layerSessionObserver } from '../sessions/session-observer';
import { layerSessionRepo, SessionRepo } from '../sessions/session-repo';
import { ChatRpc, layerChatRpc } from './chat-rpc';
import { SdkAdapter, SdkAdapterRegistry } from './sdk-adapter';

const options = (provider: ProviderId): SessionOptions => ({ provider, cwd: '/work', permissionMode: 'Default' });

interface StartedSession {
  readonly sessionId: SessionId;
  readonly resumeProviderSessionId?: ProviderSessionId;
}

interface Calls {
  readonly startups: Ref.Ref<number>;
  readonly closed: Ref.Ref<ReadonlyArray<SessionId>>;
  readonly shutdowns: Ref.Ref<number>;
  readonly started: Ref.Ref<ReadonlyArray<StartedSession>>;
  readonly sent: Ref.Ref<ReadonlyArray<UserMessage>>;
}

/** Test double for the SDK boundary: counts lifecycle calls and replays one scripted turn. */
const makeFakeAdapter = (provider: ProviderId, calls: Calls, mentions: 'native' | 'none' = 'native'): SdkAdapter => {
  const unused = Effect.void;
  return {
    capabilities: {
      provider,
      subagents: true,
      toolCalls: true,
      permissions: true,
      questions: true,
      thinking: false,
      resume: true,
      mentions,
      images: true,
    },
    startup: Ref.update(calls.startups, (n) => n + 1),
    shutdown: Ref.update(calls.shutdowns, (n) => n + 1),
    models: Effect.succeed([{ id: `${provider}-model`, efforts: ['Default'] }]),
    listCommands: ({ cwd }) =>
      Effect.succeed([{ name: `${provider}-cmd`, description: cwd, argumentHint: '' }]),
    startSession: (_options, ids) =>
      Ref.update(calls.started, (all) => [...all, ids]).pipe(
        Effect.as(ids.resumeProviderSessionId ?? ProviderSessionId.make(`${provider}-native`)),
      ),
    send: (message) =>
      Stream.fromEffect(Ref.update(calls.sent, (all) => [...all, message])).pipe(Stream.flatMap(() => Stream.fromIterable<ChatEvent>([ { _tag: 'TurnStarted', sessionId: message.sessionId, turnId: TurnId.make('t1') }, { _tag: 'TurnFinished', sessionId: message.sessionId, turnId: TurnId.make('t1'), outcome: 'Completed', usage: { inputTokens: 1, outputTokens: 2 }, }, ]))),
    resolvePermission: () => unused,
    answerQuestion: () => unused,
    interrupt: () => unused,
    closeSession: (id) => Ref.update(calls.closed, (ids) => [...ids, id]),
    append: () => unused,
    load: () => Effect.succeed([]),
    listSessions: () => Effect.succeed([]),
    listSessionMetadata: () => Effect.succeed([]),
    delete: () => unused,
    listSubagentSession: () => Effect.succeed([]),
  };
};

const makeHarnessWith = (mentions: 'native' | 'none') => Effect.gen(function* () {
  const calls: Calls = {
    startups: yield* Ref.make(0),
    closed: yield* Ref.make<ReadonlyArray<SessionId>>([]),
    shutdowns: yield* Ref.make(0),
    started: yield* Ref.make<ReadonlyArray<StartedSession>>([]),
    sent: yield* Ref.make<ReadonlyArray<UserMessage>>([]),
  };
  const layerRegistry = Layer.succeed(SdkAdapterRegistry, {
    defaultProvider: 'Claude',
    get: (provider) => Effect.succeed(makeFakeAdapter(provider, calls, mentions)),
  });
  const layerServices = Layer.mergeAll(layerProjectResolver, layerSessionObserver, layerProjectFiles()).pipe(
    Layer.provideMerge(layerSessionRepo(':memory:')),
  );
  return { calls, layer: layerChatRpc.pipe(Layer.provideMerge(Layer.merge(layerRegistry, layerServices))) };
});

const makeHarness = makeHarnessWith('native');

describe('ChatRpc', () => {
  it.effect('starts the adapter once however many calls follow', () =>
    Effect.gen(function* () {
      const { calls, layer } = yield* makeHarness;
      yield* Effect.gen(function* () {
        const chat = yield* ChatRpc;
        yield* chat.startup;
        yield* chat.startup;
        yield* chat.startSession(options('Claude'));
      }).pipe(Effect.provide(layer));
      expect(yield* Ref.get(calls.startups)).toBe(1);
    }));

  it.effect('lists the models of the active adapter', () =>
    Effect.gen(function* () {
      const { layer } = yield* makeHarness;
      const models = yield* Effect.gen(function* () {
        const chat = yield* ChatRpc;
        return yield* chat.models;
      }).pipe(Effect.provide(layer));
      expect(models).toEqual([{ id: 'Claude-model', efforts: ['Default'] }]);
    }));

  it.effect('lists the commands of the active adapter for a cwd, without an open session', () =>
    Effect.gen(function* () {
      const { layer } = yield* makeHarness;
      const commands = yield* Effect.gen(function* () {
        const chat = yield* ChatRpc;
        return yield* chat.commands('/work');
      }).pipe(Effect.provide(layer));
      expect(commands).toEqual([{ name: 'Claude-cmd', description: '/work', argumentHint: '' }]);
    }));

  it.effect('streams the adapter turn for an open session', () =>
    Effect.gen(function* () {
      const { layer } = yield* makeHarness;
      const tags = yield* Effect.gen(function* () {
        const chat = yield* ChatRpc;
        const sessionId = yield* chat.startSession(options('Claude'));
        const events = yield* Stream.runCollect(chat.send({ sessionId, text: 'hi', mentions: [], attachments: [] }));
        return events.map((event) => event._tag);
      }).pipe(Effect.provide(layer));
      expect(tags).toEqual(['TurnStarted', 'TurnFinished']);
    }));

  it.effect('hands the adapter the attachments of the message untouched', () =>
    Effect.gen(function* () {
      const { calls, layer } = yield* makeHarness;
      const id = AttachmentId.make('11111111-1111-4111-8111-111111111111');
      yield* Effect.gen(function* () {
        const chat = yield* ChatRpc;
        const sessionId = yield* chat.startSession(options('Claude'));
        yield* Stream.runCollect(chat.send({ sessionId, text: '', mentions: [], attachments: [{ id }] }));
      }).pipe(Effect.provide(layer));
      const sent = yield* Ref.get(calls.sent);
      expect(sent[0]?.attachments).toEqual([{ id }]);
    }));

  it.effect('rejects send on an unknown session', () =>
    Effect.gen(function* () {
      const { layer } = yield* makeHarness;
      const error = yield* Effect.gen(function* () {
        const chat = yield* ChatRpc;
        return yield* Stream.runCollect(
          chat.send({ sessionId: SessionId.make('nope'), text: 'hi', mentions: [], attachments: [] }),
        ).pipe(Effect.flip);
      }).pipe(Effect.provide(layer));
      expect(error).toBeInstanceOf(ChatError);
      expect(error.reason).toBe('SessionNotFound');
    }));

  it.effect('refuses a session for a provider that is not active', () =>
    Effect.gen(function* () {
      const { layer } = yield* makeHarness;
      const error = yield* Effect.gen(function* () {
        const chat = yield* ChatRpc;
        return yield* chat.startSession(options('OpenAI')).pipe(Effect.flip);
      }).pipe(Effect.provide(layer));
      expect(error.reason).toBe('Unsupported');
    }));

  it.effect('changeAdapter closes open sessions, shuts the old adapter down and starts the new one', () =>
    Effect.gen(function* () {
      const { calls, layer } = yield* makeHarness;
      const outcome = yield* Effect.gen(function* () {
        const chat = yield* ChatRpc;
        const sessionId = yield* chat.startSession(options('Claude'));
        const capabilities = yield* chat.changeAdapter('OpenAI');
        const error = yield* chat.interrupt(sessionId).pipe(Effect.flip);
        return { sessionId, capabilities, error };
      }).pipe(Effect.provide(layer));
      expect(outcome.capabilities.provider).toBe('OpenAI');
      expect(outcome.error.reason).toBe('SessionNotFound');
      expect(yield* Ref.get(calls.closed)).toEqual([outcome.sessionId]);
      expect(yield* Ref.get(calls.shutdowns)).toBe(1);
      expect(yield* Ref.get(calls.startups)).toBe(2);
    }));

  it.effect('stores a new session under our id, apart from the SDK id, in the project of its cwd', () =>
    Effect.gen(function* () {
      const { layer } = yield* makeHarness;
      const stored = yield* Effect.gen(function* () {
        const chat = yield* ChatRpc;
        const repo = yield* SessionRepo;
        const sessionId = yield* chat.startSession(options('Claude'));
        return { sessionId, row: yield* repo.get(sessionId) };
      }).pipe(Effect.provide(layer));
      expect(Option.isSome(stored.row)).toBe(true);
      expect(stored.row.pipe(Option.map((row) => row.providerSessionId))).toEqual(
        Option.some('Claude-native'),
      );
      expect(stored.row.pipe(Option.map((row) => row.sessionId))).toEqual(Option.some(stored.sessionId));
      expect(stored.sessionId).not.toBe('Claude-native');
    }));

  it.effect('names the session after the first message only', () =>
    Effect.gen(function* () {
      const { layer } = yield* makeHarness;
      const title = yield* Effect.gen(function* () {
        const chat = yield* ChatRpc;
        const repo = yield* SessionRepo;
        const sessionId = yield* chat.startSession(options('Claude'));
        yield* Stream.runCollect(chat.send({ sessionId, text: '  Fix the\n login bug ', mentions: [], attachments: [] }));
        yield* Stream.runCollect(chat.send({ sessionId, text: 'and the logout one', mentions: [], attachments: [] }));
        return (yield* repo.get(sessionId)).pipe(Option.map((row) => row.title));
      }).pipe(Effect.provide(layer));
      expect(title).toEqual(Option.some('Fix the'));
    }));

  it.effect('resumes a stored session under its own ids', () =>
    Effect.gen(function* () {
      const { calls, layer } = yield* makeHarness;
      const sessionId = yield* Effect.gen(function* () {
        const chat = yield* ChatRpc;
        const first = yield* chat.startSession(options('Claude'));
        yield* chat.closeSession(first);
        const resumed = yield* chat.startSession({ ...options('Claude'), resume: first });
        expect(resumed).toBe(first);
        expect(yield* chat.isOpen(resumed)).toBe(true);
        return first;
      }).pipe(Effect.provide(layer));
      expect(yield* Ref.get(calls.started)).toEqual([
        { sessionId },
        { sessionId, resumeProviderSessionId: 'Claude-native' },
      ]);
    }));

  it.effect('refuses to resume a session that was never stored', () =>
    Effect.gen(function* () {
      const { layer } = yield* makeHarness;
      const error = yield* Effect.gen(function* () {
        const chat = yield* ChatRpc;
        return yield* chat.startSession({ ...options('Claude'), resume: SessionId.make('nope') }).pipe(Effect.flip);
      }).pipe(Effect.provide(layer));
      expect(error.reason).toBe('SessionNotFound');
    }));

  it.effect('changeAdapter to the active provider is a no-op', () =>
    Effect.gen(function* () {
      const { calls, layer } = yield* makeHarness;
      yield* Effect.gen(function* () {
        const chat = yield* ChatRpc;
        yield* chat.startSession(options('Claude'));
        yield* chat.changeAdapter('Claude');
      }).pipe(Effect.provide(layer));
      expect(yield* Ref.get(calls.shutdowns)).toBe(0);
      expect(yield* Ref.get(calls.startups)).toBe(1);
    }));
});

const roots: string[] = [];
afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

const write = (root: string, file: string, content = 'x') => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), content);
};

/** A git repository with a tracked file, a folder, an untracked file, and an ignored `.env`. */
const makeRepo = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'timmy-mentions-'));
  roots.push(root);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init');
  write(root, '.gitignore', '.env'.concat(String.fromCharCode(10)));
  write(root, '.env', 'SECRET=1');
  write(root, 'src/a.ts');
  write(root, 'mi carpeta/a b.ts');
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'init');
  write(root, 'new.ts');
  return root;
};

describe('ChatRpc mentions', () => {
  const sendIn = (root: string, text: string) =>
    Effect.gen(function* () {
      const { calls, layer } = yield* makeHarness;
      const outcome = yield* Effect.gen(function* () {
        const chat = yield* ChatRpc;
        const sessionId = yield* chat.startSession({ ...options('Claude'), cwd: root });
        const result = yield* Stream.runCollect(chat.send({ sessionId, text, mentions: [], attachments: [] })).pipe(Effect.result);
        const again = yield* Stream.runCollect(chat.send({ sessionId, text: 'still here', mentions: [], attachments: [] }));
        return { result, usable: again.length };
      }).pipe(Effect.provide(layer));
      return { ...outcome, sent: yield* Ref.get(calls.sent) };
    });

  it.effect('hands the adapter the resolved mentions, once each, with the text untouched', () => {
    const root = makeRepo();
    const text = 'look at @src/a.ts, then @"mi carpeta/a b.ts" and @src/a.ts and @new.ts. mail me@x.com';
    return Effect.gen(function* () {
      const { sent } = yield* sendIn(root, text);
      expect(sent[0]?.text).toBe(text);
      expect(sent[0]?.mentions).toEqual([
        { path: 'src/a.ts' },
        { path: 'mi carpeta/a b.ts' },
        { path: 'new.ts' },
      ]);
    });
  });

  it.effect('fails with InvalidMention before any turn when a mention is gone or ignored, and the session stays usable', () => {
    const root = makeRepo();
    return Effect.gen(function* () {
      const { result, usable, sent } = yield* sendIn(root, 'see @nope.ts and @.env');
      expect(result._tag).toBe('Failure');
      const error = result._tag === 'Failure' ? result.failure : undefined;
      expect(error).toBeInstanceOf(ChatError);
      expect(error?.reason).toBe('InvalidMention');
      expect(error?.detail).toContain('nope.ts');
      expect(error?.detail).toContain('.env');
      expect(sent.map((m) => m.text)).toEqual(['still here']);
      expect(usable).toBeGreaterThan(0);
    });
  });

  it.effect('fails with InvalidMention when a mention points at a folder', () => {
    const root = makeRepo();
    return Effect.gen(function* () {
      const { result, sent } = yield* sendIn(root, 'see @src and @"mi carpeta"');
      expect(result._tag).toBe('Failure');
      const error = result._tag === 'Failure' ? result.failure : undefined;
      expect(error?.reason).toBe('InvalidMention');
      expect(error?.detail).toContain('src');
      expect(error?.detail).toContain('mi carpeta');
      expect(sent.map((m) => m.text)).toEqual(['still here']);
    });
  });

  it.effect('rejects absolute paths and ".." paths', () => {
    const root = makeRepo();
    return Effect.gen(function* () {
      const absolute = yield* sendIn(root, `@${path.join(root, 'src/a.ts').split(path.sep).join('/')}`);
      const parent = yield* sendIn(root, '@../outside.ts @src/../src/a.ts');
      for (const outcome of [absolute, parent]) {
        expect(outcome.result._tag).toBe('Failure');
        expect(outcome.sent.map((m) => m.text)).toEqual(['still here']);
      }
    });
  });

  it.effect('rejects a symlink that leaves the working directory', () => {
    const root = makeRepo();
    const outside = mkdtempSync(path.join(tmpdir(), 'timmy-outside-'));
    roots.push(outside);
    write(outside, 'secret.txt');
    try {
      symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
    } catch {
      return Effect.void; // symlinks need privileges on some platforms
    }
    return Effect.gen(function* () {
      const { result } = yield* sendIn(root, 'read @link.txt');
      expect(result._tag).toBe('Failure');
    });
  });
});

describe('ChatRpc mentions on an adapter without native support', () => {
  const sendWith = (root: string, text: string, adapter: 'native' | 'none' = 'none') =>
    Effect.gen(function* () {
      const { calls, layer } = yield* makeHarnessWith(adapter);
      const events = yield* Effect.gen(function* () {
        const chat = yield* ChatRpc;
        const sessionId = yield* chat.startSession({ ...options('Claude'), cwd: root });
        return yield* Stream.runCollect(chat.send({ sessionId, text, mentions: [], attachments: [] }));
      }).pipe(Effect.provide(layer));
      const sent = yield* Ref.get(calls.sent);
      return { events, prompt: sent[0]?.text ?? '' };
    });
  const trimmed = (events: ReadonlyArray<ChatEvent>) => events.some((e) => e._tag === 'MentionsTrimmed');

  it.effect('puts the content of a small file in the prompt', () => {
    const root = makeRepo();
    write(root, 'small.ts', 'const answer = 42;');
    return Effect.gen(function* () {
      const { prompt, events } = yield* sendWith(root, 'read @small.ts');
      expect(prompt.startsWith('read @small.ts')).toBe(true);
      expect(prompt).toContain('const answer = 42;');
      expect(trimmed(events)).toBe(false);
    });
  });

  it.effect('does not expand anything for a native adapter', () => {
    const root = makeRepo();
    write(root, 'small.ts', 'const answer = 42;');
    return Effect.gen(function* () {
      const { prompt } = yield* sendWith(root, 'read @small.ts', 'native');
      expect(prompt).toBe('read @small.ts');
    });
  });

  it.effect('truncates a file over 64 KB with a note and warns', () => {
    const root = makeRepo();
    write(root, 'big.txt', 'a'.repeat(70 * 1024));
    return Effect.gen(function* () {
      const { prompt, events } = yield* sendWith(root, 'read @big.txt');
      expect(prompt).toContain('[Truncated: showing 65536 of 71680 bytes.]');
      expect(prompt.length).toBeLessThan(70 * 1024);
      expect(trimmed(events)).toBe(true);
    });
  });

  it.effect('reports a binary file by name and size only', () => {
    const root = makeRepo();
    writeFileSync(path.join(root, 'pic.bin'), Buffer.from([1, 2, 0, 3, 4]));
    return Effect.gen(function* () {
      const { prompt } = yield* sendWith(root, 'see @pic.bin');
      expect(prompt).toContain('Binary file (5 bytes); content not included.');
    });
  });

  it.effect('caps the whole message at 256 KB and warns', () => {
    const root = makeRepo();
    for (const n of ['a', 'b', 'c', 'd', 'e', 'f']) write(root, `${n}.txt`, n.repeat(60 * 1024));
    return Effect.gen(function* () {
      const { prompt, events } = yield* sendWith(root, 'see @a.txt @b.txt @c.txt @d.txt @e.txt @f.txt');
      expect(prompt.length).toBeLessThan(260 * 1024);
      expect(prompt).toContain('Left out: message size limit reached.');
      expect(trimmed(events)).toBe(true);
    });
  });
});
