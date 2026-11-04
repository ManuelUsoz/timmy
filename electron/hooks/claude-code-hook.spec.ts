import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { makeClaudeCodeHook } from './claude-code-hook';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'timmy-claude-'));
  file = path.join(dir, 'settings.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const read = (): any => JSON.parse(readFileSync(file, 'utf8'));
const hook = () => makeClaudeCodeHook(file);

const userConfig = {
  model: 'opus',
  permissions: { allow: ['Bash(npm test)'] },
  hooks: {
    Stop: [{ hooks: [{ type: 'command', command: 'notify-send done' }] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: './check.sh' }] }],
  },
};

describe('Claude Code Hook: activation', () => {
  it.effect('creates the config when there is none, and reports it active', () =>
    Effect.gen(function* () {
      const claude = hook();
      expect(yield* claude.isActive).toBe(false);
      yield* claude.activate;
      expect(yield* claude.isActive).toBe(true);
      expect(Object.keys(read().hooks).sort()).toEqual(['Notification', 'PostToolUse', 'SessionEnd', 'Stop', 'UserPromptSubmit']);
    }),
  );

  it.effect('keeps the rest of the user config when activating', () =>
    Effect.gen(function* () {
      writeFileSync(file, JSON.stringify(userConfig));
      yield* hook().activate;
      const config = read();
      expect(config.model).toBe('opus');
      expect(config.permissions).toEqual(userConfig.permissions);
      expect(config.hooks.Stop[0]).toEqual(userConfig.hooks.Stop[0]);
      expect(config.hooks.PreToolUse[0]).toEqual(userConfig.hooks.PreToolUse[0]);
      expect(config.hooks.Stop).toHaveLength(2);
    }),
  );

  it.effect('activating twice does not duplicate the entries Timmy added', () =>
    Effect.gen(function* () {
      const claude = hook();
      yield* claude.activate;
      const once = read();
      yield* claude.activate;
      expect(read()).toEqual(once);
    }),
  );

  it.effect('deactivating leaves the file as the user had it', () =>
    Effect.gen(function* () {
      writeFileSync(file, JSON.stringify(userConfig));
      const claude = hook();
      yield* claude.activate;
      yield* claude.deactivate;
      expect(read()).toEqual(userConfig);
      expect(yield* claude.isActive).toBe(false);
    }),
  );

  it.effect('deactivating a config that only had the Hook drops the empty hooks key', () =>
    Effect.gen(function* () {
      writeFileSync(file, JSON.stringify({ model: 'opus' }));
      const claude = hook();
      yield* claude.activate;
      yield* claude.deactivate;
      expect(read()).toEqual({ model: 'opus' });
    }),
  );

  it.effect('deactivating without a file does nothing and does not create one', () =>
    Effect.gen(function* () {
      yield* hook().deactivate;
      expect(() => readFileSync(file)).toThrow();
    }),
  );

  it.effect('refuses to touch a config that is not valid JSON', () =>
    Effect.gen(function* () {
      writeFileSync(file, '{ "model": ');
      const error = yield* hook().activate.pipe(Effect.flip);
      expect(error.reason).toBe('ConfigUnreadable');
      expect(readFileSync(file, 'utf8')).toBe('{ "model": ');
    }),
  );

  it.effect('refuses to replace hooks of the user that are not in the shape Claude Code reads', () =>
    Effect.gen(function* () {
      const odd = JSON.stringify({ hooks: { Stop: 'echo hi' } });
      writeFileSync(file, odd);
      const error = yield* hook().activate.pipe(Effect.flip);
      expect(error.reason).toBe('ConfigUnreadable');
      expect(readFileSync(file, 'utf8')).toBe(odd);
    }),
  );

  it.effect('the written command does nothing without TIMMY_TERMINAL_ID and never fails', () =>
    Effect.gen(function* () {
      yield* hook().activate;
      const entry = read().hooks.Stop[0].hooks[0];
      expect(entry.type).toBe('command');
      expect(entry.command).toContain('TIMMY_TERMINAL_ID');
      expect(entry.command).toContain('exit 0');
    }),
  );
});

describe('Claude Code Hook: what the events mean', () => {
  const decode = (payload: unknown) => hook().decode(payload);
  const signal = (hook_event_name: string, extra: object = {}) => decode({ hook_event_name, ...extra });

  it('a submitted prompt, and a tool finishing (after a permission was answered), are Working', () => {
    expect(signal('UserPromptSubmit')).toEqual(Option.some('Working'));
    expect(signal('PostToolUse')).toEqual(Option.some('Working'));
  });

  it('a permission or question prompt is Waiting', () => {
    expect(signal('Notification', { notification_type: 'permission_prompt' })).toEqual(Option.some('Waiting'));
    expect(signal('Notification', { notification_type: 'elicitation_dialog' })).toEqual(Option.some('Waiting'));
  });

  it('finishing a response, or sitting idle, is Done', () => {
    expect(signal('Stop')).toEqual(Option.some('Done'));
    expect(signal('Notification', { notification_type: 'idle_prompt' })).toEqual(Option.some('Done'));
  });

  it('the session ending is Ended', () => {
    expect(signal('SessionEnd')).toEqual(Option.some('Ended'));
  });

  it('ignores other notifications, other events and junk', () => {
    expect(signal('Notification', { notification_type: 'auth_success' })).toEqual(Option.none());
    expect(signal('SessionStart')).toEqual(Option.none());
    expect(signal('PreToolUse')).toEqual(Option.none());
    expect(decode(null)).toEqual(Option.none());
    expect(decode('Stop')).toEqual(Option.none());
    expect(decode({})).toEqual(Option.none());
  });
});
